import { estimateBackup, type BackupEstimate, type BackupScenario } from "./backup";
import { resolveRoundTrip } from "./simulate";
import {
  DEFAULT_ANALYSIS_YEARS,
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_RATE_ESCALATOR,
  degradationOf,
  installedCost,
  internalRateOfReturn,
  netPresentValue,
  savingsCashFlows,
  simplePaybackYears,
} from "./economics";
import { simulateDispatch } from "./simulate";
import type { Battery, DispatchStrategy, RateModel, SimulationResult } from "./types";

export type CandidateMetrics = {
  battery: Battery;
  quantity: number;
  strategy: DispatchStrategy;
  installed_cost_usd: number;
  annual_savings_usd: number;
  simple_payback_years: number | null;
  npv_usd: number;
  /** Null when the cash flows have no IRR. Infinity when the battery is free and still saves money. */
  irr: number | null;
  /** Reduction of the highest hourly grid peak across the year, kW. */
  peak_reduction_kw: number;
  monthly_peak_reduction_kw: number[];
  /** (solar − export) / solar with the battery. Null when there is no solar. Losses of stored solar count as consumed. */
  self_consumption_pct: number | null;
  equivalent_cycles: number;
  /**
   * Typical backup hours: the median duration across every start hour, capped at 72.
   * Null when no backup scenario was requested. Matches `estimateBackup` `hours_typical`.
   */
  backup_hours: number | null;
  /** Full outage estimate behind `backup_hours`. Null when backup was not requested. */
  backup_estimate?: BackupEstimate | null;
  warnings: string[];
};

export type SweepInput = {
  load_kwh: readonly number[];
  solar_kwh?: readonly number[];
  rate: RateModel;
  batteries: readonly Battery[];
  max_quantity: number;
  strategy: DispatchStrategy;
  soc_min?: number;
  soc_max?: number;
  billed_peak_kw?: readonly (number | null)[];
  start_weekday?: number;
  /** Fraction. Default 0.06. */
  discount_rate?: number;
  /** Fraction. Default 0.02. */
  rate_escalator?: number;
  /** Default 25. */
  analysis_years?: number;
  /**
   * Extra quantities to keep for a battery id, such as a project selection.
   * Values outside 1..max_quantity are ignored. The peak-scaled range is unchanged otherwise.
   */
  include_quantities?: Readonly<Record<string, readonly number[]>>;
  /**
   * Fixed critical load, every hour. Used only when `backup` is omitted.
   * A load above discharge power reports zero backup hours.
   */
  critical_load_kw?: number;
  /**
   * Outage load, starting charge, and solar credit for backup hours.
   * When set, this replaces `critical_load_kw`.
   */
  backup?: BackupScenario;
};

export type RankContext = {
  target_peak_reduction_kw?: number;
  backup_target_hours?: number;
};

export type RankingMode = {
  id: string;
  label: string;
  description: string;
  compare: (a: CandidateMetrics, b: CandidateMetrics, ctx: RankContext) => number;
};

function prefer(direction: "high" | "low", a: number | null, b: number | null): number {
  const aMissing = a == null || Number.isNaN(a);
  const bMissing = b == null || Number.isNaN(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a === b) return 0;
  return direction === "high" ? b - a : a - b;
}

function thenCost(primary: number, a: CandidateMetrics, b: CandidateMetrics): number {
  if (primary !== 0) return primary;
  return a.installed_cost_usd - b.installed_cost_usd;
}

export const MAX_ANNUAL_SAVINGS: RankingMode = {
  id: "max_annual_savings",
  label: "Max annual savings",
  description: "Highest first-year bill savings. Ties prefer the lower installed cost.",
  compare: (a, b) => thenCost(prefer("high", a.annual_savings_usd, b.annual_savings_usd), a, b),
};

export const BEST_PAYBACK: RankingMode = {
  id: "best_payback",
  label: "Best payback / ROI",
  description: "Shortest simple payback. Ties prefer the higher IRR, then the lower installed cost.",
  compare: (a, b) => {
    const payback = prefer("low", a.simple_payback_years, b.simple_payback_years);
    if (payback !== 0) return payback;
    const irr = prefer("high", a.irr, b.irr);
    return thenCost(irr, a, b);
  },
};

export const MAX_LIFETIME_NPV: RankingMode = {
  id: "max_lifetime_npv",
  label: "Max lifetime NPV",
  description: "Highest net present value over the analysis period. Ties prefer the lower installed cost.",
  compare: (a, b) => thenCost(prefer("high", a.npv_usd, b.npv_usd), a, b),
};

export const MAX_SELF_CONSUMPTION: RankingMode = {
  id: "max_self_consumption",
  label: "Max solar self-consumption",
  description: "Highest share of solar that is not exported. Ties prefer the lower installed cost.",
  compare: (a, b) => thenCost(prefer("high", a.self_consumption_pct, b.self_consumption_pct), a, b),
};

export const CHEAPEST_PEAK_TARGET: RankingMode = {
  id: "cheapest_peak_reduction",
  label: "Cheapest peak-kW reduction",
  description:
    "Cheapest stack that cuts the year's highest hourly peak by at least the target. If none do, the largest reduction comes first.",
  compare: (a, b, ctx) => {
    const target = ctx.target_peak_reduction_kw;
    if (target == null || !Number.isFinite(target) || target < 0) {
      throw new Error("This ranking needs a peak-kW reduction target of zero or more.");
    }
    const aHit = a.peak_reduction_kw >= target - 1e-6;
    const bHit = b.peak_reduction_kw >= target - 1e-6;
    if (aHit !== bHit) return aHit ? -1 : 1;
    if (aHit) {
      const cost = a.installed_cost_usd - b.installed_cost_usd;
      if (cost !== 0) return cost;
      return prefer("high", a.peak_reduction_kw, b.peak_reduction_kw);
    }
    const reduction = prefer("high", a.peak_reduction_kw, b.peak_reduction_kw);
    return reduction !== 0 ? reduction : a.installed_cost_usd - b.installed_cost_usd;
  },
};

export const BACKUP_DURATION: RankingMode = {
  id: "backup_duration",
  label: "Backup duration",
  description:
    "Cheapest stack whose typical backup covers the target. Typical backup is the median hours across every start hour, using the backup settings, capped at 72 hours. If none cover the target, the longest backup comes first.",
  compare: (a, b, ctx) => {
    const target = ctx.backup_target_hours;
    if (target == null || !Number.isFinite(target) || !(target > 0)) {
      throw new Error("This ranking needs a backup target in hours, greater than zero.");
    }
    const aHit = a.backup_hours != null && a.backup_hours >= target - 1e-9;
    const bHit = b.backup_hours != null && b.backup_hours >= target - 1e-9;
    if (aHit !== bHit) return aHit ? -1 : 1;
    if (aHit) return a.installed_cost_usd - b.installed_cost_usd;
    const hours = prefer("high", a.backup_hours, b.backup_hours);
    return hours !== 0 ? hours : a.installed_cost_usd - b.installed_cost_usd;
  },
};

export const RANKING_MODES: readonly RankingMode[] = [
  MAX_ANNUAL_SAVINGS,
  BEST_PAYBACK,
  MAX_LIFETIME_NPV,
  MAX_SELF_CONSUMPTION,
  CHEAPEST_PEAK_TARGET,
  BACKUP_DURATION,
];

export const DEFAULT_RANKING_MODE = MAX_ANNUAL_SAVINGS;

export function rankingMode(id: string): RankingMode {
  const mode = RANKING_MODES.find((entry) => entry.id === id);
  if (!mode) throw new Error(`Unknown ranking mode ${id}.`);
  return mode;
}

export function rankCandidates(
  candidates: readonly CandidateMetrics[],
  mode: RankingMode = DEFAULT_RANKING_MODE,
  ctx: RankContext = {},
): CandidateMetrics[] {
  return [...candidates].sort((a, b) => mode.compare(a, b, ctx));
}

/** True when the row satisfies the active mode's peak or backup target. Modes without a target always pass. */
export function meetsRankingConstraint(row: CandidateMetrics, mode: RankingMode, ctx: RankContext = {}): boolean {
  if (mode.id === CHEAPEST_PEAK_TARGET.id) {
    const target = ctx.target_peak_reduction_kw;
    if (target == null || !Number.isFinite(target)) return true;
    return row.peak_reduction_kw >= target - 1e-6;
  }
  if (mode.id === BACKUP_DURATION.id) {
    const target = ctx.backup_target_hours;
    if (target == null || !Number.isFinite(target)) return true;
    return row.backup_hours != null && row.backup_hours >= target - 1e-9;
  }
  return true;
}

export function constraintMissLabel(row: CandidateMetrics, mode: RankingMode, ctx: RankContext = {}): string | null {
  if (meetsRankingConstraint(row, mode, ctx)) return null;
  if (mode.id === CHEAPEST_PEAK_TARGET.id) return `Misses the peak target (${ctx.target_peak_reduction_kw} kW)`;
  if (mode.id === BACKUP_DURATION.id) return `Misses the backup target (${ctx.backup_target_hours} h)`;
  return "Misses the ranking constraint";
}

/** True when every quantity of this battery misses the active target. */
export function batteryMissesConstraint(
  ranked: readonly CandidateMetrics[],
  batteryId: string,
  mode: RankingMode,
  ctx: RankContext = {},
): boolean {
  const rows = ranked.filter((row) => row.battery.id === batteryId);
  return rows.length > 0 && rows.every((row) => !meetsRankingConstraint(row, mode, ctx));
}

/**
 * Best-ranked quantity of this battery that meets the active target.
 * Quantity 1 when none of its quantities are viable.
 */
export function bestQuantityForBattery(
  ranked: readonly CandidateMetrics[],
  batteryId: string,
  mode: RankingMode,
  ctx: RankContext = {},
): number {
  for (const row of ranked) {
    if (row.battery.id !== batteryId) continue;
    if (meetsRankingConstraint(row, mode, ctx)) return row.quantity;
  }
  return 1;
}

/** Simulated stacks across one catalog. Keeps a mixed catalog of large and small units responsive. */
export const MAX_SWEEP_POINTS = 24;

/** Quantities sampled for one battery before the catalog-wide cap thins the list. */
const MAX_POINTS_PER_BATTERY = 6;

/** The override menu lists at least this many quantities, even when one unit covers the peak. */
export const OVERRIDE_QUANTITY_FLOOR = 10;

/** Hard cap on the override menu. */
export const OVERRIDE_QUANTITY_CAP = 100;

/** Stack should cover about this multiple of site peak kW and of the peak hour's kWh. */
const OVERRIDE_PEAK_COVER = 1.5;

/** Leading batteries that may get every integer in their sampled span added to the comparison. */
export const CONTIGUOUS_TOP_BATTERIES = 3;

/**
 * Extra simulations allowed when filling those spans.
 * A battery with more holes than the remaining budget stays sampled.
 */
export const CONTIGUOUS_EXTRA_BUDGET = 8;

/** A unit whose discharge is at least this multiple of site peak is swept at quantity 1. */
const OVERSIZED_POWER_RATIO = 1.5;

/** Hours of site peak a small unit should be able to cover before the sweep stops adding units. */
const ENERGY_COVER_HOURS = 2;

export function peakLoadKw(load: readonly number[]): number {
  let peak = 0;
  for (const value of load) {
    if (value > peak) peak = value;
  }
  return peak;
}

/**
 * Quantities worth simulating for one battery against the site peak.
 * `maxQuantity` is still the ceiling. A unit already far above the peak stays at 1.
 * A unit too small to matter at low counts is sampled up to the peak, not every integer.
 */
export function quantitiesForBattery(
  battery: Battery,
  peakKw: number,
  maxQuantity: number,
  include: readonly number[] = [],
): number[] {
  const ceiling = quantityCeiling(battery, peakKw, maxQuantity);
  const sampled = ceiling <= 4 ? integersThrough(ceiling) : sampleQuantities(ceiling, MAX_POINTS_PER_BATTERY);
  return mergeQuantities(sampled, include, maxQuantity);
}

/** One quantity list per battery, thinned so the catalog stays within {@link MAX_SWEEP_POINTS}. */
export function planSweepQuantities(
  batteries: readonly Battery[],
  peakKw: number,
  maxQuantity: number,
  includeById: Readonly<Record<string, readonly number[]>> = {},
): number[][] {
  const pinned = batteries.map((battery) => pinnedQuantities(includeById[battery.id] ?? [], maxQuantity));
  const lists = batteries.map((battery, index) =>
    quantitiesForBattery(battery, peakKw, maxQuantity, [...pinned[index]]),
  );
  return thinToBudget(lists, pinned);
}

function pinnedQuantities(include: readonly number[], maxQuantity: number): Set<number> {
  const pinned = new Set<number>();
  for (const qty of include) {
    if (Number.isInteger(qty) && qty >= 1 && qty <= maxQuantity) pinned.add(qty);
  }
  return pinned;
}

function quantityCeiling(battery: Battery, peakKw: number, maxQuantity: number): number {
  const peak = Number.isFinite(peakKw) && peakKw > 0 ? peakKw : 0;
  const unitKw = battery.max_discharge_rate_kw;
  const unitKwh = battery.usable_capacity_kwh;
  if (!(peak > 0) || !(unitKw > 0) || !(unitKwh > 0)) {
    return Math.min(maxQuantity, MAX_POINTS_PER_BATTERY);
  }
  if (unitKw >= peak * OVERSIZED_POWER_RATIO) return 1;
  const coverPower = Math.max(1, Math.ceil(peak / unitKw));
  const coverEnergy = Math.max(1, Math.ceil((peak * ENERGY_COVER_HOURS) / unitKwh));
  const useful = Math.max(coverPower, Math.min(coverEnergy, coverPower * 2));
  return Math.max(1, Math.min(maxQuantity, useful));
}

function integersThrough(max: number): number[] {
  const quantities: number[] = [];
  for (let quantity = 1; quantity <= max; quantity += 1) quantities.push(quantity);
  return quantities;
}

/**
 * Largest quantity the override menu offers for one battery.
 * Enough units to cover about 1.5× the site peak kW and the peak hour's kWh,
 * at least {@link OVERRIDE_QUANTITY_FLOOR}, and never above {@link OVERRIDE_QUANTITY_CAP}.
 */
export function overrideQuantityMax(battery: Battery, peakKw: number): number {
  const peak = Number.isFinite(peakKw) && peakKw > 0 ? peakKw : 0;
  const unitKw = battery.max_discharge_rate_kw;
  const unitKwh = battery.usable_capacity_kwh;
  let needed = OVERRIDE_QUANTITY_FLOOR;
  if (peak > 0 && unitKw > 0 && unitKwh > 0) {
    const coverKw = Math.ceil((peak * OVERRIDE_PEAK_COVER) / unitKw);
    const coverKwh = Math.ceil((peak * OVERRIDE_PEAK_COVER) / unitKwh);
    needed = Math.max(needed, coverKw, coverKwh);
  }
  return Math.min(OVERRIDE_QUANTITY_CAP, Math.max(1, needed));
}

/**
 * Every integer from 1 through the peak-scaled menu max.
 * Values in `also` raise that max (still capped) so a swept or selected quantity stays listed.
 */
export function quantityChoicesForBattery(
  battery: Battery,
  peakKw: number,
  also: readonly number[] = [],
): number[] {
  let max = overrideQuantityMax(battery, peakKw);
  for (const quantity of also) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > OVERRIDE_QUANTITY_CAP) continue;
    if (quantity > max) max = quantity;
  }
  return integersThrough(max);
}

function sampleQuantities(hi: number, points: number): number[] {
  const count = Math.max(1, Math.min(points, hi));
  if (count === 1) return [1];
  const chosen = new Set<number>([1, hi]);
  const steps = count - 1;
  for (let step = 1; step < steps; step += 1) {
    const value = Math.round(Math.exp((Math.log(hi) * step) / steps));
    if (value > 1 && value < hi) chosen.add(value);
  }
  let cursor = 2;
  while (chosen.size < count && cursor < hi) {
    chosen.add(cursor);
    cursor += 1;
  }
  return [...chosen].sort((a, b) => a - b);
}

function mergeQuantities(base: readonly number[], include: readonly number[], maxQuantity: number): number[] {
  const chosen = new Set(base);
  for (const qty of include) {
    if (Number.isInteger(qty) && qty >= 1 && qty <= maxQuantity) chosen.add(qty);
  }
  return [...chosen].sort((a, b) => a - b);
}

function thinToBudget(lists: number[][], pinned: Array<Set<number>>): number[][] {
  const next = lists.map((list) => [...list]);
  const total = () => next.reduce((sum, list) => sum + list.length, 0);
  while (total() > MAX_SWEEP_POINTS) {
    let index = -1;
    let longest = 0;
    for (let i = 0; i < next.length; i += 1) {
      if (next[i].length <= longest) continue;
      if (removablePoints(next[i], pinned[i]).length === 0) continue;
      longest = next[i].length;
      index = i;
    }
    if (index < 0) break;
    const droppable = removablePoints(next[index], pinned[index]);
    const drop = droppable[Math.floor((droppable.length - 1) / 2)];
    next[index] = next[index].filter((quantity) => quantity !== drop);
  }
  return next;
}

function removablePoints(list: readonly number[], pinned: ReadonlySet<number>): number[] {
  if (list.length <= 1) return [];
  const highest = list[list.length - 1];
  return list.filter((quantity) => quantity !== 1 && quantity !== highest && !pinned.has(quantity));
}

export type CandidateEvalInput = {
  load_kwh: readonly number[];
  solar_kwh?: readonly number[];
  rate: RateModel;
  battery: Battery;
  quantity: number;
  strategy: DispatchStrategy;
  soc_min?: number;
  soc_max?: number;
  billed_peak_kw?: readonly (number | null)[];
  start_weekday?: number;
  discount_rate?: number;
  rate_escalator?: number;
  analysis_years?: number;
  /** Null when backup hours were not requested. */
  backup: BackupScenario | null;
};

/** One stack: the same metrics the catalog sweep stores for a sampled quantity. */
export function evaluateCandidate(input: CandidateEvalInput): CandidateMetrics {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("quantity must be an integer of 1 or more.");
  }
  const discountRate = input.discount_rate ?? DEFAULT_DISCOUNT_RATE;
  const escalator = input.rate_escalator ?? DEFAULT_RATE_ESCALATOR;
  const years = input.analysis_years ?? DEFAULT_ANALYSIS_YEARS;
  if (!(discountRate > -1)) throw new Error("discount rate must be greater than -100%.");
  const socMin = input.soc_min ?? 0;
  const socMax = input.soc_max ?? 1;
  const simulation = simulateDispatch({
    load_kwh: input.load_kwh,
    solar_kwh: input.solar_kwh,
    rate: input.rate,
    battery: input.battery,
    quantity: input.quantity,
    strategy: input.strategy,
    soc_min: socMin,
    soc_max: socMax,
    billed_peak_kw: input.billed_peak_kw,
    start_weekday: input.start_weekday,
    include_hourly: false,
  });
  const backup = input.backup
    ? estimateBackup({
        load_kwh: input.load_kwh,
        solar_kwh: input.solar_kwh,
        battery: input.battery,
        quantity: input.quantity,
        soc_min: socMin,
        soc_max: socMax,
        ...input.backup,
      })
    : null;
  return metricsFromSimulation({
    battery: input.battery,
    quantity: input.quantity,
    strategy: input.strategy,
    simulation,
    discountRate,
    escalator,
    years,
    backup,
  });
}

/**
 * Missing integers from 1 through the highest sampled quantity, for the top few batteries,
 * when each battery's whole span fits in {@link CONTIGUOUS_EXTRA_BUDGET}.
 * A span that is not cheap is left sampled; a cheaper neighbor can still fill.
 */
export function planContiguousQuantities(ranked: readonly CandidateMetrics[]): { battery: Battery; quantities: number[] }[] {
  const ids: string[] = [];
  for (const row of ranked) {
    if (ids.includes(row.battery.id)) continue;
    ids.push(row.battery.id);
    if (ids.length >= CONTIGUOUS_TOP_BATTERIES) break;
  }
  const plans: { battery: Battery; quantities: number[] }[] = [];
  let used = 0;
  for (const id of ids) {
    const group = ranked.filter((row) => row.battery.id === id);
    const battery = group[0]?.battery;
    if (!battery) continue;
    const have = new Set(group.map((row) => row.quantity));
    let hi = 0;
    for (const quantity of have) if (quantity > hi) hi = quantity;
    const gaps: number[] = [];
    for (let quantity = 1; quantity <= hi; quantity += 1) {
      if (!have.has(quantity)) gaps.push(quantity);
    }
    if (gaps.length === 0) continue;
    if (used + gaps.length > CONTIGUOUS_EXTRA_BUDGET) continue;
    used += gaps.length;
    plans.push({ battery, quantities: gaps });
  }
  return plans;
}

export function sweepBatteries(input: SweepInput): CandidateMetrics[] {
  if (!Number.isInteger(input.max_quantity) || input.max_quantity < 1) {
    throw new Error("max_quantity must be an integer of 1 or more.");
  }
  const discountRate = input.discount_rate ?? DEFAULT_DISCOUNT_RATE;
  const escalator = input.rate_escalator ?? DEFAULT_RATE_ESCALATOR;
  const years = input.analysis_years ?? DEFAULT_ANALYSIS_YEARS;
  if (!(discountRate > -1)) throw new Error("discount rate must be greater than -100%.");
  const socMin = input.soc_min ?? 0;
  const socMax = input.soc_max ?? 1;
  const scenario = backupScenario(input);
  const plans = planSweepQuantities(
    input.batteries,
    peakLoadKw(input.load_kwh),
    input.max_quantity,
    input.include_quantities,
  );

  const ranked: CandidateMetrics[] = [];
  input.batteries.forEach((battery, index) => {
    for (const quantity of plans[index] ?? [1]) {
      ranked.push(
        evaluateCandidate({
          load_kwh: input.load_kwh,
          solar_kwh: input.solar_kwh,
          rate: input.rate,
          battery,
          quantity,
          strategy: input.strategy,
          soc_min: socMin,
          soc_max: socMax,
          billed_peak_kw: input.billed_peak_kw,
          start_weekday: input.start_weekday,
          discount_rate: discountRate,
          rate_escalator: escalator,
          analysis_years: years,
          backup: scenario,
        }),
      );
    }
  });
  return ranked;
}

function backupScenario(input: SweepInput): BackupScenario | null {
  if (input.backup) return input.backup;
  if (input.critical_load_kw == null) return null;
  if (!(input.critical_load_kw > 0) || !Number.isFinite(input.critical_load_kw)) {
    throw new Error("critical_load_kw must be greater than zero when it is set.");
  }
  return {
    load_mode: "backup_loads",
    shape: "fixed_kw",
    critical_load_kw: input.critical_load_kw,
    start_soc: 1,
    include_solar: false,
  };
}

function metricsFromSimulation(args: {
  battery: Battery;
  quantity: number;
  strategy: DispatchStrategy;
  simulation: SimulationResult;
  discountRate: number;
  escalator: number;
  years: number;
  backup: BackupEstimate | null;
}): CandidateMetrics {
  const cost = installedCost(args.battery, args.quantity);
  const savings = args.simulation.annual_savings_usd;
  const flows = savingsCashFlows({
    installedCostUsd: cost,
    annualSavingsUsd: savings,
    degradationPerYear: degradationOf(args.battery),
    rateEscalator: args.escalator,
    analysisYears: args.years,
  });
  const baselinePeak = Math.max(...args.simulation.monthly_peak_kw.baseline);
  const batteryPeak = Math.max(...args.simulation.monthly_peak_kw.with_battery);
  const solar = args.simulation.totals.solar_kwh;
  const eta = Math.sqrt(resolveRoundTrip(args.battery));
  const usable = args.battery.usable_capacity_kwh * args.quantity;
  let self: number | null = null;
  if (solar > 1e-6) {
    const ratio = (solar - args.simulation.totals.grid_export_kwh) / solar;
    self = Math.min(1, Math.max(0, ratio));
  }
  return {
    battery: args.battery,
    quantity: args.quantity,
    strategy: args.strategy,
    installed_cost_usd: cost,
    annual_savings_usd: savings,
    simple_payback_years: simplePaybackYears(cost, savings),
    npv_usd: netPresentValue(args.discountRate, flows),
    irr: internalRateOfReturn(flows),
    peak_reduction_kw: baselinePeak - batteryPeak,
    monthly_peak_reduction_kw: args.simulation.monthly_peak_kw.baseline.map(
      (peak, month) => peak - args.simulation.monthly_peak_kw.with_battery[month],
    ),
    self_consumption_pct: self,
    equivalent_cycles: usable > 0 ? args.simulation.totals.discharge_ac_kwh / eta / usable : 0,
    backup_hours: args.backup ? args.backup.hours_typical : null,
    backup_estimate: args.backup,
    warnings: args.simulation.warnings,
  };
}
