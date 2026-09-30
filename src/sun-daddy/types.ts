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

/** A row from `project.economics.batteries`. Quantity is null when the export omits a whole-number count. */
export type SelectedBattery = {
  battery_id: string;
  quantity: number | null;
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
};

/** Phase 1 inputs plus the warnings the normalizer refused to guess through. */
export type NormalizedStudy = {
  schema_version: number | null;
  project_id: string | null;
  project_name: string | null;
  warnings: string[];
  /** Null when the hourly series is missing or has gaps. */
  load_kwh: number[] | null;
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
