import { HOURS_PER_YEAR } from "./calendar";
import { backupPowerKw, chargePowerKw, effectiveUsableKwh } from "./specs";
import { resolveRoundTrip } from "./simulate";
import type { Battery } from "./types";

/** Sliding outage runs stop here so a near-zero load does not report a year of backup. */
export const BACKUP_HORIZON_HOURS = 72;

/** Backup loads default to this share of each hour of the building load. */
export const DEFAULT_BACKUP_LOAD_FRACTION = 0.3;

const POWER_EPS = 1e-6;
const ENERGY_EPS = 1e-6;

export type BackupLoadMode = "whole_building" | "backup_loads";
export type BackupLoadShape = "fixed_kw" | "percent_of_load";

/**
 * How the outage load is built. Whole-building uses the hourly profile.
 * Backup loads use either a fixed kW or a percent of each hour.
 */
export type BackupScenario = {
  load_mode: BackupLoadMode;
  /** Required for backup loads. Ignored for the whole building. */
  shape?: BackupLoadShape;
  /** Fixed kW, every hour. Used when shape is fixed_kw. */
  critical_load_kw?: number;
  /** Fraction of each building-load hour. 0.3 is 30%. Used when shape is percent_of_load. */
  critical_load_fraction?: number;
  /** Fraction of usable kWh. Default 1. Clamped into the SOC window. */
  start_soc?: number;
  /**
   * Credit hourly solar toward the outage load and battery charge.
   * Default false. Optimistic unless the site can island.
   */
  include_solar?: boolean;
};

export type BackupEstimateInput = BackupScenario & {
  load_kwh: readonly number[];
  solar_kwh?: readonly number[];
  battery: Battery;
  quantity: number;
  soc_min?: number;
  soc_max?: number;
  horizon_hours?: number;
};

export type BackupEstimate = {
  /** Median hours across every start hour. The headline's "about" figure. Capped at the horizon. */
  hours_typical: number;
  /** 10th percentile of start hours. Nine starts in ten last at least this long. */
  hours_conservative: number;
  hours_min: number;
  hours_max: number;
  /** Deliverable AC kWh ÷ average outage load. Uncapped. Null when the average load is zero. */
  hours_at_average_load: number | null;
  /** Deliverable AC kWh ÷ peak outage load. Zero when that peak is above discharge power. Null when the peak is zero. */
  hours_at_peak_load: number | null;
  average_load_kw: number;
  peak_load_kw: number;
  discharge_kw: number;
  deliverable_ac_kwh: number;
  /** Largest amount by which an hour of outage load exceeds discharge power. */
  power_shortfall_kw: number;
  hours_load_exceeds_power: number;
  /** True when at least one hour of the outage load is above discharge power. */
  cannot_carry_load: boolean;
  include_solar: boolean;
  load_mode: BackupLoadMode;
  /** Starting charge actually used, after clamping to the SOC window. */
  start_soc: number;
  horizon_hours: number;
  horizon_reached: boolean;
};

export const BACKUP_ASSUMPTIONS = [
  "Heuristic estimate, not a backup design or an outage guarantee.",
  "Hourly resolution only. Each value is the average kW that hour, so a short spike inside the hour is invisible.",
  "Usable energy starts at the chosen state of charge, clamped to the SOC window, and stops at the SOC minimum. Discharge-side efficiency is the square root of round-trip efficiency.",
  "Discharge power is the pack's aggregate max discharge kW. An hour the remaining load exceeds that limit ends the backup, even if energy is left.",
  "Inverter standby losses are ignored. There is no standby-loss input on the battery. Surge and motor-start loads are ignored.",
  "Every hour of the year is tried as an outage start. The run stops when the battery is empty or cannot cover the hour, and it is capped at 72 hours.",
  "The headline's first number is the median start. The conservative number is the 10th percentile.",
  "Include solar during an outage is optimistic. Grid-tied inverters shut down unless the equipment can island.",
] as const;

type PackBackup = {
  eta: number;
  startKwh: number;
  socMinKwh: number;
  socMaxKwh: number;
  maxDischarge: number;
  maxCharge: number;
  deliverableAc: number;
  startSoc: number;
};

export function estimateBackup(input: BackupEstimateInput): BackupEstimate {
  const pack = packOf(input);
  const horizon = horizonOf(input.horizon_hours);
  const load = outageLoad(input.load_kwh, input);
  const solar = input.include_solar ? solarSeries(input.solar_kwh) : null;
  const durations = solar
    ? durationsWithSolar(load, solar, pack, horizon)
    : durationsWithoutSolar(load, pack.deliverableAc, pack.maxDischarge, horizon);
  const summary = summarize(durations, horizon);
  const stats = loadStats(load, pack.maxDischarge);
  return {
    ...summary,
    hours_at_average_load: hoursAtLevel(stats.average, pack.deliverableAc, pack.maxDischarge),
    hours_at_peak_load: hoursAtLevel(stats.peak, pack.deliverableAc, pack.maxDischarge),
    average_load_kw: stats.average,
    peak_load_kw: stats.peak,
    discharge_kw: pack.maxDischarge,
    deliverable_ac_kwh: pack.deliverableAc,
    power_shortfall_kw: stats.shortfall,
    hours_load_exceeds_power: stats.hoursOver,
    cannot_carry_load: stats.hoursOver > 0,
    include_solar: solar != null,
    load_mode: input.load_mode,
    start_soc: pack.startSoc,
    horizon_hours: horizon,
  };
}

export function formatBackupHeadline(estimate: BackupEstimate): string {
  return `About ${estimate.hours_typical.toFixed(1)} hours (conservative ${estimate.hours_conservative.toFixed(1)} hours)`;
}

export function formatBackupPowerLimit(estimate: BackupEstimate): string | null {
  if (!estimate.cannot_carry_load) return null;
  const message = `The battery cannot carry this load. The peak outage load is ${estimate.peak_load_kw.toFixed(1)} kW, ${estimate.power_shortfall_kw.toFixed(1)} kW above the ${estimate.discharge_kw.toFixed(1)} kW discharge limit, in ${groupHours(estimate.hours_load_exceeds_power)} hours of the year.`;
  if (!estimate.include_solar) return message;
  return `${message} Hours are counted on the load itself. With solar included, an hour can still be covered when generation makes up the difference.`;
}

function packOf(input: BackupEstimateInput): PackBackup {
  const battery = input.battery;
  if (!battery || typeof battery.id !== "string" || battery.id.length === 0) throw new Error("Battery needs an id.");
  if (!(battery.usable_capacity_kwh > 0)) throw new Error("usable_capacity_kwh must be greater than zero.");
  if (!(battery.max_charge_rate_kw >= 0)) throw new Error("max_charge_rate_kw must be zero or positive.");
  if (!(battery.max_discharge_rate_kw >= 0)) throw new Error("max_discharge_rate_kw must be zero or positive.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("quantity must be an integer of 1 or more.");
  }
  const rte = resolveRoundTrip(battery);
  if (!(rte > 0 && rte <= 1)) throw new Error("round_trip_efficiency must be greater than 0 and at most 1.");
  const socMin = input.soc_min ?? 0;
  const socMax = input.soc_max ?? 1;
  if (!(socMin >= 0 && socMax <= 1 && socMax > socMin)) {
    throw new Error("SOC window must satisfy 0 ≤ soc_min < soc_max ≤ 1.");
  }
  const requested = input.start_soc ?? 1;
  if (!Number.isFinite(requested) || requested < 0 || requested > 1) {
    throw new Error("Starting state of charge must be from 0% to 100%.");
  }
  const startSoc = Math.min(socMax, Math.max(socMin, requested));
  const usable = effectiveUsableKwh(battery) * input.quantity;
  const eta = Math.sqrt(rte);
  return {
    eta,
    startKwh: usable * startSoc,
    socMinKwh: usable * socMin,
    socMaxKwh: usable * socMax,
    maxDischarge: backupPowerKw(battery) * input.quantity,
    maxCharge: chargePowerKw(battery) * input.quantity,
    deliverableAc: usable * (startSoc - socMin) * eta,
    startSoc,
  };
}

function horizonOf(hours: number | undefined): number {
  const horizon = hours ?? BACKUP_HORIZON_HOURS;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > HOURS_PER_YEAR) {
    throw new Error("Backup horizon must be a whole number of hours from 1 to 8,760.");
  }
  return horizon;
}

function outageLoad(load: readonly number[], scenario: BackupScenario): Float64Array {
  assertYear(load, "load_kwh");
  const out = new Float64Array(HOURS_PER_YEAR);
  if (scenario.load_mode === "whole_building") {
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) out[hour] = finiteKw(load[hour], "load_kwh");
    return out;
  }
  if (scenario.load_mode !== "backup_loads") {
    throw new Error("Backup load mode must be whole building or backup loads.");
  }
  if (scenario.shape === "percent_of_load") {
    const fraction = scenario.critical_load_fraction;
    if (fraction == null || !Number.isFinite(fraction) || !(fraction > 0) || fraction > 1) {
      throw new Error("Backup load percent must be greater than 0 and at most 100.");
    }
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      out[hour] = finiteKw(load[hour], "load_kwh") * fraction;
    }
    return out;
  }
  if (scenario.shape === "fixed_kw") {
    const kw = scenario.critical_load_kw;
    if (kw == null || !Number.isFinite(kw) || !(kw > 0)) {
      throw new Error("Critical load must be greater than zero.");
    }
    out.fill(kw);
    return out;
  }
  throw new Error("Backup loads need a fixed kW or a percent of the building load.");
}

function solarSeries(solar: readonly number[] | undefined): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR);
  if (solar == null) return out;
  assertYear(solar, "solar_kwh");
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) out[hour] = finiteKw(solar[hour], "solar_kwh");
  return out;
}

function assertYear(series: readonly number[], label: string): void {
  if (series.length !== HOURS_PER_YEAR) throw new Error(`${label} must have 8,760 hours.`);
}

function finiteKw(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite for every hour.`);
  return value > 0 ? value : 0;
}

/**
 * No solar, so state of charge only falls. The longest fully covered window from each
 * start only grows as the start moves forward, which lets one pass cover the year.
 * A final partial hour is added when energy runs out inside an hour the inverter can power.
 */
function durationsWithoutSolar(
  load: Float64Array,
  deliverableAc: number,
  maxDischarge: number,
  horizon: number,
): Float64Array {
  const length = load.length;
  const prefix = new Float64Array(length + horizon + 1);
  for (let hour = 0; hour < length + horizon; hour += 1) {
    prefix[hour + 1] = prefix[hour] + load[hour % length];
  }
  const durations = new Float64Array(length);
  let end = 0;
  for (let start = 0; start < length; start += 1) {
    if (end < start) end = start;
    while (end < start + horizon) {
      const kw = load[end % length];
      if (kw > maxDischarge + POWER_EPS) break;
      if (prefix[end + 1] - prefix[start] > deliverableAc + ENERGY_EPS) break;
      end += 1;
    }
    const spanned = end - start;
    if (spanned >= horizon) {
      durations[start] = horizon;
      continue;
    }
    const kw = load[end % length];
    if (kw > maxDischarge + POWER_EPS) {
      durations[start] = spanned;
      continue;
    }
    const remain = deliverableAc - (prefix[end] - prefix[start]);
    if (!(kw > ENERGY_EPS) || remain <= ENERGY_EPS) durations[start] = spanned;
    else durations[start] = Math.min(horizon, spanned + Math.min(1, remain / kw));
  }
  return durations;
}

function durationsWithSolar(load: Float64Array, solar: Float64Array, pack: PackBackup, horizon: number): Float64Array {
  const durations = new Float64Array(load.length);
  for (let start = 0; start < load.length; start += 1) {
    durations[start] = durationFromStart(start, load, solar, pack, horizon);
  }
  return durations;
}

function durationFromStart(
  start: number,
  load: Float64Array,
  solar: Float64Array,
  pack: PackBackup,
  horizon: number,
): number {
  let soc = pack.startKwh;
  let hours = 0;
  const length = load.length;
  for (let step = 0; step < horizon; step += 1) {
    const hour = (start + step) % length;
    const loadKw = load[hour];
    const solarKw = solar[hour];
    const solarToLoad = solarKw > 0 ? Math.min(solarKw, loadKw) : 0;
    const excess = solarKw - solarToLoad;
    const net = loadKw - solarToLoad;
    if (net > pack.maxDischarge + POWER_EPS) break;
    if (net > ENERGY_EPS) {
      const availableAc = (soc - pack.socMinKwh) * pack.eta;
      if (availableAc + ENERGY_EPS < net) {
        if (availableAc > ENERGY_EPS) hours += Math.min(1, availableAc / net);
        break;
      }
      soc -= net / pack.eta;
      if (soc < pack.socMinKwh) soc = pack.socMinKwh;
    }
    if (excess > ENERGY_EPS && soc < pack.socMaxKwh) {
      const roomAc = (pack.socMaxKwh - soc) / pack.eta;
      const chargeAc = Math.min(excess, pack.maxCharge, Math.max(0, roomAc));
      if (chargeAc > 0) soc += chargeAc * pack.eta;
      if (soc > pack.socMaxKwh) soc = pack.socMaxKwh;
    }
    hours += 1;
  }
  return Math.min(hours, horizon);
}

function summarize(durations: Float64Array, horizon: number): Pick<
  BackupEstimate,
  "hours_typical" | "hours_conservative" | "hours_min" | "hours_max" | "horizon_reached"
> {
  const sorted = Array.from(durations);
  sorted.sort((a, b) => a - b);
  const hoursMin = sorted[0] ?? 0;
  const hoursMax = sorted[sorted.length - 1] ?? 0;
  return {
    hours_min: hoursMin,
    hours_max: hoursMax,
    hours_typical: quantile(sorted, 0.5),
    hours_conservative: quantile(sorted, 0.1),
    horizon_reached: hoursMax >= horizon - ENERGY_EPS,
  };
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low] ?? 0;
  const weight = rank - low;
  return (sorted[low] ?? 0) * (1 - weight) + (sorted[high] ?? 0) * weight;
}

function loadStats(load: Float64Array, maxDischarge: number): {
  average: number;
  peak: number;
  shortfall: number;
  hoursOver: number;
} {
  let sum = 0;
  let peak = 0;
  let shortfall = 0;
  let hoursOver = 0;
  for (let hour = 0; hour < load.length; hour += 1) {
    const kw = load[hour];
    sum += kw;
    if (kw > peak) peak = kw;
    if (kw > maxDischarge + POWER_EPS) {
      hoursOver += 1;
      const gap = kw - maxDischarge;
      if (gap > shortfall) shortfall = gap;
    }
  }
  return { average: sum / load.length, peak, shortfall, hoursOver };
}

function hoursAtLevel(kw: number, deliverableAc: number, maxDischarge: number): number | null {
  if (!(kw > POWER_EPS)) return null;
  if (kw > maxDischarge + POWER_EPS) return 0;
  return deliverableAc / kw;
}

/** Shares of average building load shown when Sun Daddy has not set a critical-load target. */
export const BACKUP_LOAD_SHARES = [1, 0.75, 0.5, 0.25] as const;

export type BackupLimit = "kwh" | "kw";

export type BackupShareHours = {
  /** 1 is 100% of average building load. */
  loadFraction: number;
  hours: number | null;
  limitedBy: BackupLimit | null;
};

export type BackupTargetShare = {
  targetHours: number;
  /** Share of average load that meets the target, capped at 100%. Null when average load is 0. */
  percentOfBuilding: number | null;
  /** Uncapped share. Above 1 means the whole building still has energy left at the target hour. */
  uncappedFraction: number | null;
  limitedBy: BackupLimit | null;
  wholeBuildingMeetsTarget: boolean;
};

export type BackupRecommendation = {
  deliverableAcKwh: number;
  powerKw: number;
  averageLoadKw: number;
  shares: BackupShareHours[];
  targets: BackupTargetShare[];
};

/**
 * Backup hours at fixed shares of average load, and the share of the building
 * that meets each target hour count.
 *
 * Energy is the same deliverable AC kWh as the outage estimate: usable kWh after
 * min_reserve_pct, from a full charge down to the SOC minimum, times the square
 * root of round-trip efficiency. Power is continuous_kw when the catalog sets it,
 * otherwise max discharge kW. A share whose kW is above that power is limited by
 * kW (hours are 0). Otherwise the hours are energy ÷ kW and the limit is kWh.
 */
export function recommendBackup(args: {
  battery: Battery;
  quantity: number;
  averageLoadKw: number;
  targetHours?: readonly number[];
  socMin?: number;
  socMax?: number;
  startSoc?: number;
}): BackupRecommendation {
  const pack = packOf({
    load_mode: "whole_building",
    load_kwh: [],
    battery: args.battery,
    quantity: args.quantity,
    soc_min: args.socMin,
    soc_max: args.socMax,
    start_soc: args.startSoc,
  });
  const average = args.averageLoadKw;
  const targets = args.targetHours && args.targetHours.length > 0 ? args.targetHours : [4, 8];
  return {
    deliverableAcKwh: pack.deliverableAc,
    powerKw: pack.maxDischarge,
    averageLoadKw: average,
    shares: BACKUP_LOAD_SHARES.map((fraction) => shareHours(fraction, average, pack.deliverableAc, pack.maxDischarge)),
    targets: targets.map((hours) => targetShare(hours, average, pack.deliverableAc, pack.maxDischarge)),
  };
}

function shareHours(fraction: number, averageKw: number, deliverableAc: number, powerKw: number): BackupShareHours {
  if (!(averageKw > POWER_EPS)) return { loadFraction: fraction, hours: null, limitedBy: null };
  const loadKw = averageKw * fraction;
  if (loadKw > powerKw + POWER_EPS) return { loadFraction: fraction, hours: 0, limitedBy: "kw" };
  return { loadFraction: fraction, hours: deliverableAc / loadKw, limitedBy: "kwh" };
}

function targetShare(targetHours: number, averageKw: number, deliverableAc: number, powerKw: number): BackupTargetShare {
  if (!(averageKw > POWER_EPS) || !(targetHours > 0)) {
    return { targetHours, percentOfBuilding: null, uncappedFraction: null, limitedBy: null, wholeBuildingMeetsTarget: false };
  }
  const energyFraction = deliverableAc / (averageKw * targetHours);
  const powerFraction = powerKw / averageKw;
  const uncapped = Math.min(energyFraction, powerFraction);
  const limitedBy: BackupLimit = powerFraction < energyFraction ? "kw" : "kwh";
  return {
    targetHours,
    percentOfBuilding: Math.min(1, Math.max(0, uncapped)) * 100,
    uncappedFraction: uncapped,
    limitedBy,
    wholeBuildingMeetsTarget: uncapped >= 1 - 1e-9,
  };
}

function groupHours(hours: number): string {
  return Math.round(hours)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
