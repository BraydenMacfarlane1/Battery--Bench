import type { CatalogSnap } from "./catalog";
import type { DemandSeason } from "./tariff";

export type LoadQuality = "FACT" | "RULE_OF_THUMB";

export type IntervalPoint = {
  ts?: string;
  kw: number;
};

export type MonthlySegment = {
  start_date?: string;
  end_date?: string;
  month_index?: number;
  total_kwh?: number;
  peak_demand_kw: number;
};

export type BessSnapshot = {
  pre_rate?: {
    as_of?: string;
    facilities_usd_per_kw?: number;
    power_usd_per_kw?: { summer?: number; winter?: number };
    schedule_code?: string;
  } | null;
  segments?: MonthlySegment[];
  interval_kw_optional?: {
    quality?: LoadQuality;
    interval_minutes?: number;
    points?: IntervalPoint[];
  } | null;
  sizing: {
    use_case?: string;
    target_kw: number;
    soc_min_pct?: number;
    soc_max_pct?: number;
    eta_discharge?: number;
    eol_retention?: number;
    duration_h_preset?: number;
    site?: {
      placement?: string;
      setback_ft_assumed?: number;
    };
  };
};

export type SizingResult = {
  method: "peak_shave_area_above_threshold";
  quality: LoadQuality;
  p_batt_kw: number;
  e_usable_kwh: number;
  e_nameplate_kwh: number;
  duration_h: number;
  catalog_snap: CatalogSnap | null;
  demand_rate_usd_per_kw_mo: number;
  gross_demand_savings_usd_mo: number;
  assumptions: {
    soc_window: number;
    eta_discharge: number;
    eol_retention: number;
    tariff_as_of: string;
    schedule: "RMP_UT_6";
  };
  flags: string[];
};

export type DemandPreview = {
  peak_kw: number;
  season: DemandSeason;
  season_assumed: boolean;
  p_batt_kw: number;
  facilities_usd_per_kw: number;
  power_usd_per_kw: number;
  demand_rate_usd_per_kw_mo: number;
  gross_demand_savings_usd_mo: number;
  tariff_as_of: string;
};

export type MonthGrossRow = {
  label: string;
  peak_kw: number;
  shave_kw: number;
  season: DemandSeason;
  demand_rate_usd_per_kw_mo: number;
  gross_demand_savings_usd_mo: number;
};
