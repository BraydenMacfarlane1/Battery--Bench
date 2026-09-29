import { ALL_HOURS } from "./calendar";
import type { RateModel } from "./types";
import {
  CUSTOMER_CHARGE_USD_MO,
  ENERGY_USD_PER_KWH,
  RMP_SCHED_6_STAMP,
  SCHEDULE_CODE,
} from "../sizing/tariff";

/**
 * Built-in example only. The hourly engine does not assume this tariff.
 * Rates are the same stamp as the Schedule 6 worksheet (2026-08-10), before riders and tax.
 */
export function rmpSchedule6Rate(): RateModel {
  return {
    id: SCHEDULE_CODE,
    name: "Rocky Mountain Power Utah Schedule 6 (example stamp 2026-08-10)",
    seasons: [
      { id: "summer", start_month: 6, end_month: 9 },
      { id: "winter", start_month: 10, end_month: 5 },
    ],
    energy_periods: [
      {
        name: "Summer energy",
        season_ids: ["summer"],
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        energy_rate_kwh: ENERGY_USD_PER_KWH.summer,
      },
      {
        name: "Winter energy",
        season_ids: ["winter"],
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        energy_rate_kwh: ENERGY_USD_PER_KWH.winter,
      },
    ],
    demand_components: [
      {
        name: "Facilities",
        is_facilities: true,
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        demand_rate_kw: RMP_SCHED_6_STAMP.facilitiesUsdPerKw,
      },
      {
        name: "Summer power",
        season_ids: ["summer"],
        is_facilities: false,
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        demand_rate_kw: RMP_SCHED_6_STAMP.powerUsdPerKw.summer,
      },
      {
        name: "Winter power",
        season_ids: ["winter"],
        is_facilities: false,
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        demand_rate_kw: RMP_SCHED_6_STAMP.powerUsdPerKw.winter,
      },
    ],
    fixed_monthly_charge: CUSTOMER_CHARGE_USD_MO,
    export_credit_kwh: 0,
  };
}
