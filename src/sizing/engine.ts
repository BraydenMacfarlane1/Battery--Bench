import { snapCatalog } from "./catalog";
import { roundTo } from "./round";
import {
  demandRate,
  grossDemandUsd,
  RMP_SCHED_6_STAMP,
  SCHEDULE_CODE,
  seasonFromMonthIndex,
  seasonFromTimestamp,
  type DemandSeason,
  type TariffStamp,
} from "./tariff";
import type {
  BessSnapshot,
  DemandPreview,
  IntervalPoint,
  LoadQuality,
  MonthGrossRow,
  MonthlySegment,
  SizingResult,
} from "./types";

const DEFAULT_SOC_WINDOW = 0.8;
const DEFAULT_ETA_DISCHARGE = 0.95;
const DEFAULT_EOL_RETENTION = 0.8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected a finite number.");
  }
  return value;
}

function readSnapshot(input: unknown): BessSnapshot {
  if (!isRecord(input)) throw new Error("Snapshot must be an object.");
  if (!isRecord(input.sizing)) throw new Error("sizing.target_kw is required.");
  const target = input.sizing.target_kw;
  if (typeof target !== "number" || !Number.isFinite(target)) {
    throw new Error("sizing.target_kw must be a finite number.");
  }
  if (target < 0) throw new Error("sizing.target_kw must be zero or positive.");

  let useCase: string | undefined;
  if (typeof input.sizing.use_case === "string") useCase = input.sizing.use_case;
  else if (input.sizing.use_case != null) throw new Error("sizing.use_case must be a string.");

  const sizing: BessSnapshot["sizing"] = {
    use_case: useCase,
    target_kw: target,
    soc_min_pct: optionalNumber(input.sizing.soc_min_pct),
    soc_max_pct: optionalNumber(input.sizing.soc_max_pct),
    eta_discharge: optionalNumber(input.sizing.eta_discharge),
    eol_retention: optionalNumber(input.sizing.eol_retention),
    duration_h_preset: optionalNumber(input.sizing.duration_h_preset),
  };

  if (isRecord(input.sizing.site)) {
    const placement = input.sizing.site.placement;
    const setback = input.sizing.site.setback_ft_assumed;
    sizing.site = {
      placement: typeof placement === "string" ? placement : undefined,
      setback_ft_assumed: setback == null ? undefined : optionalNumber(setback),
    };
  }

  let preRate: BessSnapshot["pre_rate"] = null;
  if (isRecord(input.pre_rate)) {
    const power = isRecord(input.pre_rate.power_usd_per_kw) ? input.pre_rate.power_usd_per_kw : undefined;
    preRate = {
      as_of: typeof input.pre_rate.as_of === "string" ? input.pre_rate.as_of : undefined,
      facilities_usd_per_kw: optionalNumber(input.pre_rate.facilities_usd_per_kw),
      power_usd_per_kw: power
        ? {
            summer: optionalNumber(power.summer),
            winter: optionalNumber(power.winter),
          }
        : undefined,
      schedule_code: typeof input.pre_rate.schedule_code === "string" ? input.pre_rate.schedule_code : undefined,
    };
  }

  const segments = readSegments(input.segments);
  const intervals = readIntervals(input.interval_kw_optional);

  return {
    pre_rate: preRate,
    segments,
    interval_kw_optional: intervals,
    sizing,
  };
}

function readSegments(value: unknown): MonthlySegment[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("segments must be an array.");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`segments[${index}] must be an object.`);
    const peak = entry.peak_demand_kw;
    if (typeof peak !== "number" || !Number.isFinite(peak) || peak < 0) {
      throw new Error(`segments[${index}].peak_demand_kw must be zero or positive.`);
    }
    return {
      start_date: typeof entry.start_date === "string" ? entry.start_date : undefined,
      end_date: typeof entry.end_date === "string" ? entry.end_date : undefined,
      month_index: entry.month_index == null ? undefined : optionalNumber(entry.month_index),
      total_kwh: entry.total_kwh == null ? undefined : optionalNumber(entry.total_kwh),
      peak_demand_kw: peak,
    };
  });
}

function readIntervals(value: unknown): BessSnapshot["interval_kw_optional"] {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("interval_kw_optional must be an object.");
  let quality: LoadQuality | undefined;
  if (value.quality == null) quality = undefined;
  else if (value.quality === "FACT" || value.quality === "RULE_OF_THUMB") quality = value.quality;
  else throw new Error("interval quality must be FACT or RULE_OF_THUMB.");
  const pointsIn = value.points;
  if (pointsIn == null) return { quality, interval_minutes: optionalNumber(value.interval_minutes), points: [] };
  if (!Array.isArray(pointsIn)) throw new Error("interval points must be an array.");
  const points: IntervalPoint[] = pointsIn.map((point, index) => {
    if (!isRecord(point)) throw new Error(`interval points[${index}] must be an object.`);
    const kw = point.kw;
    if (typeof kw !== "number" || !Number.isFinite(kw) || kw < 0) {
      throw new Error(`interval points[${index}].kw must be zero or positive.`);
    }
    return {
      ts: typeof point.ts === "string" ? point.ts : undefined,
      kw,
    };
  });
  return {
    quality,
    interval_minutes: optionalNumber(value.interval_minutes),
    points,
  };
}

function stampFromSnapshot(snapshot: BessSnapshot): TariffStamp {
  const pre = snapshot.pre_rate;
  return {
    asOf: pre?.as_of || RMP_SCHED_6_STAMP.asOf,
    facilitiesUsdPerKw: pre?.facilities_usd_per_kw ?? RMP_SCHED_6_STAMP.facilitiesUsdPerKw,
    powerUsdPerKw: {
      summer: pre?.power_usd_per_kw?.summer ?? RMP_SCHED_6_STAMP.powerUsdPerKw.summer,
      winter: pre?.power_usd_per_kw?.winter ?? RMP_SCHED_6_STAMP.powerUsdPerKw.winter,
    },
  };
}

function seasonOfSegment(segment: MonthlySegment): DemandSeason | null {
  if (segment.start_date) {
    const fromDate = seasonFromTimestamp(segment.start_date);
    if (fromDate) return fromDate;
  }
  if (segment.month_index != null) return seasonFromMonthIndex(segment.month_index);
  return null;
}

type PeakPick = {
  peakKw: number;
  season: DemandSeason;
  assumed: boolean;
  source: "interval" | "monthly";
};

function resolvePeak(snapshot: BessSnapshot): PeakPick {
  const points = snapshot.interval_kw_optional?.points ?? [];
  if (points.length > 0) {
    let peakPoint = points[0];
    for (const point of points) {
      if (point.kw > peakPoint.kw) peakPoint = point;
    }
    const fromTs = peakPoint.ts ? seasonFromTimestamp(peakPoint.ts) : null;
    if (fromTs) return { peakKw: peakPoint.kw, season: fromTs, assumed: false, source: "interval" };
    const segmentSeason = seasonFromSegments(snapshot.segments);
    if (segmentSeason) {
      return { peakKw: peakPoint.kw, season: segmentSeason, assumed: false, source: "interval" };
    }
    return { peakKw: peakPoint.kw, season: "summer", assumed: true, source: "interval" };
  }

  const segments = snapshot.segments ?? [];
  if (segments.length === 0) {
    throw new Error("Add a monthly peak (kW) or 15-minute intervals.");
  }
  let design = segments[0];
  for (const segment of segments) {
    if (segment.peak_demand_kw > design.peak_demand_kw) design = segment;
  }
  const season = seasonOfSegment(design);
  if (season) return { peakKw: design.peak_demand_kw, season, assumed: false, source: "monthly" };
  return { peakKw: design.peak_demand_kw, season: "summer", assumed: true, source: "monthly" };
}

function seasonFromSegments(segments: MonthlySegment[] | undefined): DemandSeason | null {
  if (!segments?.length) return null;
  let design = segments[0];
  for (const segment of segments) {
    if (segment.peak_demand_kw > design.peak_demand_kw) design = segment;
  }
  return seasonOfSegment(design);
}

function assertPeakShave(snapshot: BessSnapshot): void {
  const useCase = snapshot.sizing.use_case;
  if (useCase && useCase !== "peak_shave") {
    throw new Error(
      `v1 supports peak_shave only (received ${useCase}). TODO: TOU energy shift is not implemented.`,
    );
  }
}

function batteryKw(peakKw: number, targetKw: number): number {
  return roundTo(Math.max(0, peakKw - targetKw), 4);
}

function intervalEnergy(points: IntervalPoint[], targetKw: number, intervalMinutes: number): number {
  const dtHours = intervalMinutes / 60;
  let energy = 0;
  for (const point of points) {
    energy += Math.max(0, point.kw - targetKw) * dtHours;
  }
  return energy;
}

function socWindow(snapshot: BessSnapshot): number {
  const min = snapshot.sizing.soc_min_pct;
  const max = snapshot.sizing.soc_max_pct;
  if (min == null && max == null) return DEFAULT_SOC_WINDOW;
  if (min == null || max == null) {
    throw new Error("Provide both soc_min_pct and soc_max_pct, or neither.");
  }
  const window = (max - min) / 100;
  if (!(window > 0) || window > 1) throw new Error("SOC window must be between 0 and 1.");
  return window;
}

function includeOutdoorSetbackFlag(site: BessSnapshot["sizing"]["site"]): boolean {
  if (!site || (site.placement == null && site.setback_ft_assumed == null)) return true;
  const placement = site.placement ?? "";
  const outdoor = placement === "" || placement.startsWith("outdoor");
  const setback = site.setback_ft_assumed ?? 10;
  return outdoor && setback === 10;
}

function resultFlags(quality: LoadQuality, usedIntervals: boolean, site: BessSnapshot["sizing"]["site"], assumedSeason: boolean): string[] {
  const flags: string[] = [];
  if (usedIntervals && quality === "RULE_OF_THUMB") flags.push("synthetic_interval_fixture");
  if (includeOutdoorSetbackFlag(site)) flags.push("outdoor_setback_default_10ft_confirm_AHJ");
  flags.push("not_a_code_or_engineering_stamp");
  if (assumedSeason) flags.push("season_assumed_summer");
  return flags;
}

function demandPreviewFrom(snapshot: BessSnapshot): DemandPreview & { stamp: TariffStamp } {
  assertPeakShave(snapshot);
  const peak = resolvePeak(snapshot);
  const stamp = stampFromSnapshot(snapshot);
  const rate = demandRate(peak.season, stamp);
  const pBatt = batteryKw(peak.peakKw, snapshot.sizing.target_kw);
  return {
    peak_kw: peak.peakKw,
    season: peak.season,
    season_assumed: peak.assumed,
    p_batt_kw: pBatt,
    facilities_usd_per_kw: rate.facilitiesUsdPerKw,
    power_usd_per_kw: rate.powerUsdPerKw,
    demand_rate_usd_per_kw_mo: rate.usdPerKwMo,
    gross_demand_savings_usd_mo: grossDemandUsd(pBatt, rate.usdPerKwMo),
    tariff_as_of: rate.asOf,
    stamp,
  };
}

/** Power and gross demand dollars. Does not require a duration preset. */
export function peakShaveDemand(input: unknown): DemandPreview {
  const preview = demandPreviewFrom(readSnapshot(input));
  const { stamp: _stamp, ...demand } = preview;
  return demand;
}

export function monthlyGrossTable(input: unknown): MonthGrossRow[] {
  const snapshot = readSnapshot(input);
  assertPeakShave(snapshot);
  const stamp = stampFromSnapshot(snapshot);
  return (snapshot.segments ?? []).map((segment) => {
    const season = seasonOfSegment(segment) ?? "summer";
    const rate = demandRate(season, stamp);
    const shave = batteryKw(segment.peak_demand_kw, snapshot.sizing.target_kw);
    const label = segment.start_date?.slice(0, 7) || "month";
    return {
      label,
      peak_kw: segment.peak_demand_kw,
      shave_kw: shave,
      season,
      demand_rate_usd_per_kw_mo: rate.usdPerKwMo,
      gross_demand_savings_usd_mo: grossDemandUsd(shave, rate.usdPerKwMo),
    };
  });
}

/**
 * Peak-shave sizer.
 * P_batt = peak − target.
 * Intervals: E_usable = Σ max(0, kW − target) × Δt. Quality defaults to FACT.
 * Monthly: E_usable = P_batt × duration_h preset. Quality is RULE_OF_THUMB.
 * E_nameplate = E_usable / (SOC window × η_discharge × EOL retention).
 */
export function sizeBessSnapshot(input: unknown): SizingResult {
  const snapshot = readSnapshot(input);
  const preview = demandPreviewFrom(snapshot);
  const points = snapshot.interval_kw_optional?.points ?? [];
  const usedIntervals = points.length > 0;

  let preciseEnergy: number;
  let quality: LoadQuality;
  if (usedIntervals) {
    const minutes = snapshot.interval_kw_optional?.interval_minutes ?? 15;
    if (!(minutes > 0)) throw new Error("interval_minutes must be greater than zero.");
    preciseEnergy = intervalEnergy(points, snapshot.sizing.target_kw, minutes);
    quality = snapshot.interval_kw_optional?.quality ?? "FACT";
  } else {
    const duration = snapshot.sizing.duration_h_preset;
    if (duration == null) {
      throw new Error(
        "Monthly sizing needs sizing.duration_h_preset (hours). Bills do not include peak shape — this preset is RULE_OF_THUMB.",
      );
    }
    if (!(duration > 0)) throw new Error("duration_h_preset must be greater than zero.");
    preciseEnergy = preview.p_batt_kw * duration;
    quality = "RULE_OF_THUMB";
  }

  const eUsable = roundTo(preciseEnergy, 4);
  const window = socWindow(snapshot);
  const eta = snapshot.sizing.eta_discharge ?? DEFAULT_ETA_DISCHARGE;
  const eol = snapshot.sizing.eol_retention ?? DEFAULT_EOL_RETENTION;
  if (!(eta > 0) || !(eol > 0)) throw new Error("Discharge efficiency and EOL retention must be greater than zero.");
  const preciseNameplate = preview.p_batt_kw === 0 ? 0 : preciseEnergy / (window * eta * eol);
  const durationH = preview.p_batt_kw > 0 ? roundTo(preciseEnergy / preview.p_batt_kw, 2) : 0;

  return {
    method: "peak_shave_area_above_threshold",
    quality,
    p_batt_kw: preview.p_batt_kw,
    e_usable_kwh: eUsable,
    e_nameplate_kwh: roundTo(preciseNameplate, 1),
    duration_h: durationH,
    catalog_snap: snapCatalog(preciseNameplate),
    demand_rate_usd_per_kw_mo: preview.demand_rate_usd_per_kw_mo,
    gross_demand_savings_usd_mo: preview.gross_demand_savings_usd_mo,
    assumptions: {
      soc_window: window,
      eta_discharge: eta,
      eol_retention: eol,
      tariff_as_of: preview.tariff_as_of,
      schedule: SCHEDULE_CODE,
    },
    flags: resultFlags(quality, usedIntervals, snapshot.sizing.site, preview.season_assumed),
  };
}
