/** 24 flags, index = hour beginning (0 is 00:00–01:00). */
export type HourMask = readonly boolean[];

export type SeasonDef = {
  id: string;
  /** Calendar month 1–12. When start is after end, the season wraps the new year. */
  start_month: number;
  end_month: number;
};

/**
 * Energy prices stack: an hour's import rate is the sum of every matching period.
 * That covers both non-overlapping TOU windows and adders (delivery, surcharges).
 */
export type EnergyPeriod = {
  name: string;
  season_ids?: readonly string[];
  /** Calendar months 1–12. Applied with season_ids when both are set. */
  months?: readonly number[];
  weekday_hours: HourMask;
  weekend_hours: HourMask;
  energy_rate_kwh: number;
  /**
   * Export credit for this period, $/kWh.
   * If any matching period sets this, the hour uses the sum of those credits.
   * Otherwise the rate-level export_credit_kwh is used.
   */
  export_rate_kwh?: number;
};

/**
 * Demand is $/kW of the highest hourly grid import inside the window, each month
 * the window is active. Components stack.
 */
export type DemandComponent = {
  name: string;
  season_ids?: readonly string[];
  months?: readonly number[];
  weekday_hours: HourMask;
  weekend_hours: HourMask;
  demand_rate_kw: number;
  /** Facilities charges ignore the hour masks and apply to every hour in their months. */
  is_facilities: boolean;
};

export type RateModel = {
  id?: string;
  name?: string;
  seasons: readonly SeasonDef[];
  energy_periods: readonly EnergyPeriod[];
  demand_components: readonly DemandComponent[];
  /** All-year customer charge, $ per month. */
  fixed_monthly_charge: number;
  /** Fallback export credit, $/kWh, when no matching period sets export_rate_kwh. */
  export_credit_kwh: number;
  /** Floor on the monthly subtotal after export credits and before tax. */
  min_bill_usd?: number;
  /** Fraction. 0.06 means 6%. Applied only to a positive after-minimum subtotal. */
  tax_rate?: number;
};

export type Battery = {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  usable_capacity_kwh: number;
  max_charge_rate_kw: number;
  max_discharge_rate_kw: number;
  cost_per_unit: number;
  /** Units after the first. Defaults to cost_per_unit. */
  cost_per_additional_unit?: number;
  /** AC round trip. Default 0.90. */
  round_trip_efficiency?: number;
  /** Fractional loss of usable capacity per year. Default 0.02. Not applied inside the single-year dispatch. */
  degradation_per_year?: number;
};

export type DispatchStrategy = "demand_peak_shave" | "tou_arbitrage" | "solar_self_consumption" | "combined";

export type SimulationInput = {
  /** 8,760 values. kWh during the hour, equal to average kW. */
  load_kwh: readonly number[];
  /** 8,760 values. Defaults to zero. */
  solar_kwh?: readonly number[];
  rate: RateModel;
  battery: Battery;
  quantity: number;
  strategy: DispatchStrategy;
  /** Fraction of usable capacity. Default 0. */
  soc_min?: number;
  /** Fraction of usable capacity. Default 1. */
  soc_max?: number;
  /**
   * Optional billed (often 15-minute) monthly peak kW, January–December.
   * Null months are left unscaled.
   */
  billed_peak_kw?: readonly (number | null)[];
  /** Weekday of hour 0. 0 = Sunday … 6 = Saturday. Default 1 (Monday). */
  start_weekday?: number;
  /** Include the 8,760-hour series on the result. Default true. */
  include_hourly?: boolean;
};

export type DemandLine = {
  name: string;
  peak_kw: number;
  assessed_kw: number;
  rate_per_kw: number;
  usd: number;
};

export type MonthBill = {
  month: number;
  energy_usd: number;
  export_credit_usd: number;
  demand_usd: number;
  demand_lines: DemandLine[];
  fixed_usd: number;
  pre_min_usd: number;
  min_bill_applied: boolean;
  tax_usd: number;
  total_usd: number;
};

export type AnnualBill = {
  months: MonthBill[];
  total_usd: number;
  energy_usd: number;
  export_credit_usd: number;
  demand_usd: number;
  fixed_usd: number;
  tax_usd: number;
};

export type HourlyDispatch = {
  charge_ac_kwh: number[];
  discharge_ac_kwh: number[];
  grid_import_kwh: number[];
  grid_export_kwh: number[];
  soc_end_kwh: number[];
};

export type SimulationTotals = {
  load_kwh: number;
  solar_kwh: number;
  charge_ac_kwh: number;
  discharge_ac_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  soc_start_kwh: number;
  soc_end_kwh: number;
};

export type SimulationResult = {
  battery_id: string;
  quantity: number;
  strategy: DispatchStrategy;
  annual_savings_usd: number;
  baseline: AnnualBill;
  with_battery: AnnualBill;
  monthly_peak_kw: {
    baseline: number[];
    with_battery: number[];
  };
  /** Monthly flat import cap used by peak-shave and combined. Null for the other strategies. */
  demand_threshold_kw: Array<number | null>;
  totals: SimulationTotals;
  hourly?: HourlyDispatch;
  warnings: string[];
};
