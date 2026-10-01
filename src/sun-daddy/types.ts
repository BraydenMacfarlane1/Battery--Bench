import type { Battery, RateModel } from "../dispatch/types";

/** Economics percents in the export are already converted to fractions. */
export type NormalizedEconomics = {
  discount_rate: number | null;
  rate_escalator: number | null;
  federal_tax_rate: number | null;
  state_tax_rate: number | null;
  analysis_period: number | null;
  system_size_kw: number | null;
};

/** A row from `project.batteries` or `project.economics.batteries`. Quantity is null when the export omits a whole-number count. */
export type SelectedBattery = {
  battery_id: string;
  quantity: number | null;
  /** Present when the export named a charge source, such as "solar" or "grid". */
  charge_source?: string;
};

/** One incentive row. Percents stay in the export's units (30 means 30%) until the incentive math converts them. */
export type ProjectIncentive = {
  incentive_name: string | null;
  incentive_type: string | null;
  value: number | null;
  cap_amount: number | null;
  applies_to: string | null;
  credit_level: string | null;
  applies_battery_ids: string[];
  payout_timing: string | null;
  spread_years: number | null;
};

/**
 * Battery incentive inputs. Tax rates and itc_pct are fractions (0.30 = 30%).
 * critical_load_pct is also a fraction (0.30 = 30% of the building).
 * Null means Sun Daddy has not filled the field.
 */
export type ProjectFinance = {
  itc_pct: number | null;
  itc_adders: number | null;
  critical_load_pct: number | null;
  backup_hours_target: number | null;
  use_macrs: boolean | null;
  federal_tax_rate: number | null;
  state_tax_rate: number | null;
  battery_equipment_cost: number | null;
  /** True when cost_adders is a non-empty array. The rows are not priced. */
  cost_adders_present: boolean;
  incentives: ProjectIncentive[];
};

export type SunDaddyMonthlyBills = {
  pre_usd: (number | null)[] | null;
  post_usd: (number | null)[] | null;
};

/** One row of `sunddaddy_results`. Sun Daddy's solar-plus-battery proposal, not a battery-only result. */
export type SunDaddyResult = {
  post_rate_id: string | null;
  dispatch_strategy: string | null;
  annual_savings: number | null;
  payback_years: number | null;
  npv: number | null;
  irr: number | null;
  monthly_bills: SunDaddyMonthlyBills | null;
  computed_at: string | null;
  stale: boolean | null;
};

export type BillCheckStatus = "ok" | "no_actuals" | "blocked" | "error";
export type BillCheckGrade = "A" | "B" | "C" | "D";

export type BillCheckPeriod = {
  actual: number | null;
  modeled: number | null;
  delta_usd: number | null;
  delta_pct: number | null;
};

export type BillCheckAnnual = {
  actual: number | null;
  modeled: number | null;
  delta_pct: number | null;
};

/** Sun Daddy's bill check. This app displays it and does not rebuild it. */
export type BillCheck = {
  status: BillCheckStatus | null;
  blocked_reason: string | null;
  rate_id: string | null;
  rate_name: string | null;
  periods: BillCheckPeriod[] | null;
  by_month: unknown;
  annual: BillCheckAnnual | null;
  grade: BillCheckGrade | null;
  other_info_usd: number | null;
  notes: string | null;
  warnings: string[] | null;
};

/** How the first load profile described its hourly series, including sources the older badge does not name. */
export type HourlySourceKind = "measured" | "synthesized_from_bills" | "building_type_shape" | "unknown";

export type LoadProfileMeta = {
  /** Raw token, when the export sent one. */
  hourly_source: string | null;
  hourly_kind: HourlySourceKind;
  monthly_source: string | null;
  peaks_source: string | null;
  warnings: string[];
  bill_segments: unknown;
  bill_check: BillCheck | null;
};

export type RateVerification = {
  source_url: string | null;
  last_verified_at: string | null;
  effective_date: string | null;
  verified_by: string | null;
};

export type NemScheduleInfo = {
  id: string | null;
  name: string | null;
  is_nem_schedule: boolean | null;
  nem_type: string | null;
  export_credit_enabled: boolean | null;
  export_credit_summer_kwh: number | null;
  export_credit_winter_kwh: number | null;
  netting: string | null;
  export_credit_scope: string | null;
  export_credit_basis: string | null;
};

export type NormalizedSolarSeries = {
  solar_type: string | null;
  label: string;
  annual_kwh: number | null;
  /** Present only when all 8,760 hours are numbers. Gaps are not filled in. */
  hourly_kwh: number[] | null;
};

export type NormalizedRate = {
  rate: RateModel | null;
  warnings: string[];
  /** Raw utility name from the rate record, before display tidy-up. */
  utility: string | null;
  /** State code from the rate record, such as "NV". */
  state: string | null;
  verification: RateVerification;
  /** Null when the export had no NEM object. */
  nem: NemScheduleInfo | null;
};

/** How `load.hourly_source` described a complete hourly series. */
export type LoadHourlySource = "measured" | "estimated";

/** Phase 1 inputs plus the warnings the normalizer refused to guess through. */
export type NormalizedStudy = {
  schema_version: number | null;
  project_id: string | null;
  project_name: string | null;
  warnings: string[];
  /** Null when the hourly series is missing or has gaps. */
  load_kwh: number[] | null;
  /** Null when the export does not name the source of the hourly series. */
  load_hourly_source: LoadHourlySource | null;
  monthly_kwh: number[] | null;
  /** January–December. Null where the export has no peak. */
  billed_peak_kw: (number | null)[];
  /** Sum of solar series that have a complete hourly shape. */
  solar_kwh: number[] | null;
  solar_series: NormalizedSolarSeries[];
  pre_rate: NormalizedRate;
  post_rates: NormalizedRate[];
  batteries: Battery[];
  /** Batteries and quantities chosen on the project. The catalog itself stays separate. */
  selected_batteries: SelectedBattery[];
  economics: NormalizedEconomics;
  finance: ProjectFinance;
  /** Sun Daddy's own proposal results. Reference only. */
  sunddaddy_results: SunDaddyResult[];
  /** First load profile. Bill check and source tags live here. */
  load_profile: LoadProfileMeta;
  /** Top-level `units` value, unchanged. Null when the export omitted it. */
  units: unknown;
};

export type ProjectListItem = {
  id: string;
  name: string;
  /** Present when the export included a string or number customer id. */
  customer_id?: string;
  /** Present when the export included a customer name. Missing names group as "No customer". */
  customer_name?: string;
  label?: string;
  project_type?: string;
  status?: string;
  site_address?: string;
  utility?: string;
  updated_at?: string;
  /** kW, when the list entry includes a system size. */
  system_size_kw?: number;
};

export const TARIFF_INCOMPLETE = "Could not fully price this tariff.";

export const SUN_DADDY_NOT_CONFIGURED =
  "Sun Daddy export is not configured. Set the SUN_DADDY_EXPORT_TOKEN secret on the worker.";
