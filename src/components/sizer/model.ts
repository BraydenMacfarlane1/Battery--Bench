import {
  type BackupEstimate,
  type BackupLoadMode,
  type BackupLoadShape,
  type BackupScenario,
} from "../../dispatch/backup";
import { HOURS_PER_YEAR, NO_HOURS, hoursBetween } from "../../dispatch/calendar";
import {
  batteryMissesConstraint,
  bestQuantityForBattery,
  constraintMissLabel,
  rankCandidates,
  rankingMode,
  sweepBatteries,
  type CandidateMetrics,
  type RankContext,
  type RankingMode,
} from "../../dispatch/rank";
import { parseBilledPeaks } from "../../dispatch/series-input";
import type { Battery, DispatchStrategy, RateModel } from "../../dispatch/types";
import { signedMoney, signedYears } from "./format";

export type BatteryRow = {
  key: string;
  name: string;
  usable: string;
  charge: string;
  discharge: string;
  cost: string;
  extra: string;
};

export type SimpleRateInput = {
  flatEnergy: string;
  peakEnergy: string;
  peakStart: string;
  peakEnd: string;
  facilities: string;
  peakDemand: string;
  fixedCharge: string;
  exportCredit: string;
};

export type SweepForm = {
  loadKwh: number[];
  solarKwh: number[];
  rate: RateModel;
  simpleRate: boolean;
  simple: SimpleRateInput;
  batteries: BatteryRow[];
  strategy: DispatchStrategy;
  rte: string;
  degradation: string;
  socMin: string;
  socMax: string;
  discount: string;
  escalator: string;
  analysisYears: string;
  maxQuantity: string;
  criticalKw: string;
  backupMode: BackupLoadMode;
  backupShape: BackupLoadShape;
  backupPercent: string;
  outageSoc: string;
  outageSolar: boolean;
  billedText: string;
};

export type SimContext = {
  load_kwh: number[];
  solar_kwh: number[];
  rate: RateModel;
  strategy: DispatchStrategy;
  soc_min: number;
  soc_max: number;
  billed_peak_kw?: (number | null)[];
  backup: BackupScenario;
};

export type SweepSuccess = {
  ok: true;
  swept: CandidateMetrics[];
  sim: SimContext;
};

export type SweepFailure = { ok: false; error: string };

export type RankSuccess = {
  ok: true;
  ranked: CandidateMetrics[];
  swept: CandidateMetrics[];
  mode: RankingMode;
  ctx: RankContext;
  sim: SimContext;
};

export function rowsFromBatteries(batteries: Battery[]): BatteryRow[] {
  return batteries.map((battery) => ({
    key: battery.id,
    name: battery.name,
    usable: String(battery.usable_capacity_kwh),
    charge: String(battery.max_charge_rate_kw),
    discharge: String(battery.max_discharge_rate_kw),
    cost: String(battery.cost_per_unit),
    extra: String(battery.cost_per_additional_unit ?? battery.cost_per_unit),
  }));
}

export function runSweep(form: SweepForm): SweepSuccess | SweepFailure {
  if (form.loadKwh.length !== HOURS_PER_YEAR) {
    return { ok: false, error: "Load an 8,760-hour profile to rank batteries." };
  }
  try {
    const activeRate = form.simpleRate ? buildSimpleRate(form.simple) : form.rate;
    const catalog = batteriesToCatalog(form.batteries, Number(form.rte) / 100, Number(form.degradation) / 100);
    const quantity = Number(form.maxQuantity);
    const min = Number(form.socMin) / 100;
    const max = Number(form.socMax) / 100;
    const yearsCount = Number(form.analysisYears);
    const discountRate = Number(form.discount) / 100;
    const rateEscalator = Number(form.escalator) / 100;
    const billed = parseBilledPeaks(form.billedText);
    const backup = backupScenarioFromInputs({
      backupMode: form.backupMode,
      backupShape: form.backupShape,
      backupPercent: form.backupPercent,
      criticalKw: form.criticalKw,
      outageSoc: form.outageSoc,
      outageSolar: form.outageSolar,
    });
    if (!(quantity >= 1) || !Number.isInteger(quantity) || quantity > 12) {
      return { ok: false, error: "Max units must be a whole number from 1 to 12." };
    }
    if (!(min >= 0) || !(max <= 1) || !(min < max)) {
      return { ok: false, error: "The state-of-charge window must sit between 0% and 100%, with the max above the min." };
    }
    const solar = form.solarKwh.length === HOURS_PER_YEAR ? form.solarKwh : new Array<number>(HOURS_PER_YEAR).fill(0);
    const swept = sweepBatteries({
      load_kwh: form.loadKwh,
      solar_kwh: solar,
      rate: activeRate,
      batteries: catalog,
      max_quantity: quantity,
      strategy: form.strategy,
      soc_min: min,
      soc_max: max,
      billed_peak_kw: billed ?? undefined,
      discount_rate: discountRate,
      rate_escalator: rateEscalator,
      analysis_years: yearsCount,
      backup,
    });
    return {
      ok: true,
      swept,
      sim: {
        load_kwh: form.loadKwh,
        solar_kwh: solar,
        rate: activeRate,
        strategy: form.strategy,
        soc_min: min,
        soc_max: max,
        billed_peak_kw: billed ?? undefined,
        backup,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not rank these batteries." };
  }
}

export function rankSweep(sweep: SweepSuccess, modeId: string, peakTarget: string, backupHours: string): RankSuccess | SweepFailure {
  try {
    const mode = rankingMode(modeId);
    const ctx = {
      target_peak_reduction_kw: Number(peakTarget),
      backup_target_hours: Number(backupHours),
    };
    const ranked = rankCandidates(sweep.swept, mode, ctx);
    return { ok: true, ranked, swept: sweep.swept, mode, ctx, sim: sweep.sim };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not rank these batteries." };
  }
}

export function resolveSelection(
  ranked: readonly CandidateMetrics[],
  override: { batteryId: string; quantity: number } | null,
): { top: CandidateMetrics; selected: CandidateMetrics; pinned: boolean } | null {
  const top = ranked[0];
  if (!top) return null;
  const match = override
    ? ranked.find((row) => row.battery.id === override.batteryId && row.quantity === override.quantity)
    : undefined;
  return { top, selected: match ?? top, pinned: match != null };
}

export function uniqueBatteries(rows: readonly CandidateMetrics[]): Battery[] {
  const seen = new Map<string, Battery>();
  for (const row of rows) {
    if (!seen.has(row.battery.id)) seen.set(row.battery.id, row.battery);
  }
  return [...seen.values()];
}

export function seriesByBattery(rows: CandidateMetrics[]): { name: string; points: { kwh: number; savings: number }[] }[] {
  const groups = new Map<string, { name: string; points: { kwh: number; savings: number }[] }>();
  for (const row of rows) {
    const group = groups.get(row.battery.id) ?? { name: row.battery.name, points: [] };
    group.points.push({
      kwh: row.battery.usable_capacity_kwh * row.quantity,
      savings: row.annual_savings_usd,
    });
    groups.set(row.battery.id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    points: group.points.sort((a, b) => a.kwh - b.kwh),
  }));
}

export function compareWithBest(selected: CandidateMetrics, best: CandidateMetrics, modeLabel: string): string {
  const savings = signedMoney(selected.annual_savings_usd - best.annual_savings_usd);
  let payback = "payback unavailable";
  if (selected.simple_payback_years != null && best.simple_payback_years != null) {
    payback = `${signedYears(selected.simple_payback_years - best.simple_payback_years)} payback`;
  }
  return `Compared with the best for ${modeLabel}: ${savings} / yr savings, ${payback}.`;
}

export function backupScenarioText(
  backupMode: BackupLoadMode,
  backupShape: BackupLoadShape,
  backupPercent: string,
  criticalKw: string,
  estimate: BackupEstimate,
  outageSolar: boolean,
): string {
  const charge = `${Math.round(estimate.start_soc * 100)}% charge`;
  const solar = outageSolar ? "Solar is credited (optimistic)." : "Solar is not credited.";
  if (backupMode === "whole_building") return `Whole building load, starting at ${charge}. ${solar}`;
  if (backupShape === "percent_of_load") {
    return `Backup loads at ${backupPercent}% of each hour, starting at ${charge}. ${solar}`;
  }
  return `Backup loads at ${criticalKw} kW, starting at ${charge}. ${solar}`;
}

export function chooseQuantityForBattery(
  ranked: readonly CandidateMetrics[],
  batteryId: string,
  mode: RankingMode,
  ctx: RankContext,
): number {
  return bestQuantityForBattery(ranked, batteryId, mode, ctx);
}

export { batteryMissesConstraint, constraintMissLabel };

export function backupScenarioFromInputs(input: {
  backupMode: BackupLoadMode;
  backupShape: BackupLoadShape;
  backupPercent: string;
  criticalKw: string;
  outageSoc: string;
  outageSolar: boolean;
}): BackupScenario {
  const start = Number(input.outageSoc) / 100;
  if (!Number.isFinite(start) || start < 0 || start > 1) {
    throw new Error("Outage starting charge must be from 0% to 100%.");
  }
  return {
    load_mode: input.backupMode,
    shape: input.backupMode === "backup_loads" ? input.backupShape : undefined,
    critical_load_kw:
      input.backupMode === "backup_loads" && input.backupShape === "fixed_kw" ? Number(input.criticalKw) : undefined,
    critical_load_fraction:
      input.backupMode === "backup_loads" && input.backupShape === "percent_of_load"
        ? Number(input.backupPercent) / 100
        : undefined,
    start_soc: start,
    include_solar: input.outageSolar,
  };
}

export function buildSimpleRate(input: SimpleRateInput): RateModel {
  const start = Number(input.peakStart);
  const end = Number(input.peakEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start) {
    throw new Error("Peak hours must be whole hours, with the end after the start.");
  }
  const offPeak = hoursBetween(0, 24).map((_, hour) => hour < start || hour >= end);
  return {
    id: "simple",
    name: "Simple rate (not a utility tariff)",
    seasons: [],
    energy_periods: [
      {
        name: "Off-peak",
        weekday_hours: offPeak,
        weekend_hours: hoursBetween(0, 24),
        energy_rate_kwh: requiredNumber(input.flatEnergy, "Off-peak energy"),
      },
      {
        name: "On-peak",
        weekday_hours: hoursBetween(start, end),
        weekend_hours: NO_HOURS,
        energy_rate_kwh: requiredNumber(input.peakEnergy, "On-peak energy"),
      },
    ],
    demand_components: [
      {
        name: "Facilities",
        is_facilities: true,
        weekday_hours: hoursBetween(0, 24),
        weekend_hours: hoursBetween(0, 24),
        demand_rate_kw: requiredNumber(input.facilities, "Facilities demand"),
      },
      {
        name: "On-peak demand",
        is_facilities: false,
        weekday_hours: hoursBetween(start, end),
        weekend_hours: NO_HOURS,
        demand_rate_kw: requiredNumber(input.peakDemand, "On-peak demand"),
      },
    ],
    fixed_monthly_charge: requiredNumber(input.fixedCharge, "Fixed charge"),
    export_credit_kwh: requiredNumber(input.exportCredit, "Export credit"),
  };
}

function requiredNumber(text: string, label: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or positive.`);
  return value;
}

export function batteriesToCatalog(rows: BatteryRow[], roundTrip: number, degradation: number): Battery[] {
  if (rows.length === 0) throw new Error("Add at least one battery.");
  if (!(roundTrip > 0) || roundTrip > 1) throw new Error("Round-trip efficiency must be between 0% and 100%.");
  if (!(degradation >= 0) || degradation >= 1) throw new Error("Degradation must be from 0% up to, but not including, 100%.");
  return rows.map((row) => ({
    id: row.key,
    name: row.name.trim() || "Battery",
    usable_capacity_kwh: requiredPositive(row.usable, `${row.name} usable kWh`),
    max_charge_rate_kw: requiredNumber(row.charge, `${row.name} charge kW`),
    max_discharge_rate_kw: requiredNumber(row.discharge, `${row.name} discharge kW`),
    cost_per_unit: requiredNumber(row.cost, `${row.name} first cost`),
    cost_per_additional_unit: requiredNumber(row.extra, `${row.name} additional cost`),
    round_trip_efficiency: roundTrip,
    degradation_per_year: degradation,
  }));
}

function requiredPositive(text: string, label: string): number {
  const value = requiredNumber(text, label);
  if (!(value > 0)) throw new Error(`${label} must be greater than zero.`);
  return value;
}
