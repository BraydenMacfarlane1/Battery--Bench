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
  economics: NormalizedEconomics;
};

export type ProjectListItem = {
  id: string;
  name: string;
};

export const TARIFF_INCOMPLETE = "Could not fully price this tariff.";

export const SUN_DADDY_NOT_CONFIGURED =
  "Sun Daddy export is not configured. Set the SUN_DADDY_EXPORT_TOKEN secret on the worker.";
