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

  const ranked: CandidateMetrics[] = [];
  for (const battery of input.batteries) {
    for (let quantity = 1; quantity <= input.max_quantity; quantity += 1) {
      const simulation = simulateDispatch({
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
        include_hourly: false,
      });
      const backup = scenario
        ? estimateBackup({
            load_kwh: input.load_kwh,
            solar_kwh: input.solar_kwh,
            battery,
            quantity,
            soc_min: socMin,
            soc_max: socMax,
            ...scenario,
          })
        : null;
      ranked.push(
        metricsFromSimulation({
          battery,
          quantity,
          strategy: input.strategy,
          simulation,
          discountRate,
          escalator,
          years,
          backup,
        }),
      );
    }
  }
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
