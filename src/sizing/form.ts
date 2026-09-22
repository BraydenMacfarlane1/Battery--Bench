import { RMP_SCHED_6_STAMP } from "./tariff";
import type { BessSnapshot, LoadQuality } from "./types";

export type MonthInput = {
  startDate: string;
  peakKw: number;
  totalKwh: number | null;
};

export type FormInput = {
  mode: "monthly" | "interval";
  targetKw: number;
  months: MonthInput[];
  durationHours: number | null;
  points: { ts: string; kw: number }[];
  intervalQuality: LoadQuality;
  intervalMinutes: number;
};

export function buildSnapshotFromForm(form: FormInput): BessSnapshot {
  const snapshot: BessSnapshot = {
    pre_rate: {
      as_of: RMP_SCHED_6_STAMP.asOf,
      facilities_usd_per_kw: RMP_SCHED_6_STAMP.facilitiesUsdPerKw,
      power_usd_per_kw: {
        summer: RMP_SCHED_6_STAMP.powerUsdPerKw.summer,
        winter: RMP_SCHED_6_STAMP.powerUsdPerKw.winter,
      },
      schedule_code: "6",
    },
    segments: form.months.map((month) => ({
      start_date: month.startDate || undefined,
      peak_demand_kw: month.peakKw,
      total_kwh: month.totalKwh ?? undefined,
    })),
    sizing: {
      use_case: "peak_shave",
      target_kw: form.targetKw,
      soc_min_pct: 20,
      soc_max_pct: 100,
      eta_discharge: 0.95,
      eol_retention: 0.8,
      site: {
        placement: "outdoor_pad",
        setback_ft_assumed: 10,
      },
    },
  };

  if (form.mode === "interval") {
    snapshot.interval_kw_optional = {
      quality: form.intervalQuality,
      interval_minutes: form.intervalMinutes,
      points: form.points,
    };
  } else if (form.durationHours != null) {
    snapshot.sizing.duration_h_preset = form.durationHours;
  }

  return snapshot;
}
