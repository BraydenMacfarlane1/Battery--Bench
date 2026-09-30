import { ALL_HOURS, HOURS_PER_YEAR, NO_HOURS, buildCalendar, hoursBetween } from "./calendar";
import type { Battery, RateModel } from "./types";

/**
 * Illustrative building, solar, and round-number prices for the screen when Sun Daddy is absent.
 * None of these figures are a utility tariff or a customer interval file.
 */
export function syntheticExample(): {
  load_kwh: number[];
  solar_kwh: number[];
  rate: RateModel;
  batteries: Battery[];
  billed_peak_kw: number[];
} {
  const calendar = buildCalendar(1);
  const load = new Array<number>(HOURS_PER_YEAR);
  const solar = new Array<number>(HOURS_PER_YEAR);
  for (const stamp of calendar) {
    const weekdayPeak = !stamp.isWeekend && stamp.hour >= 14 && stamp.hour <= 18;
    const weekdayDay = !stamp.isWeekend && stamp.hour >= 8 && stamp.hour <= 20;
    let kw = stamp.isWeekend ? 35 : 45;
    if (weekdayDay) kw = 70;
    if (weekdayPeak) kw = 120;
    load[stamp.index] = kw;
    const sun =
      stamp.hour >= 8 && stamp.hour <= 16 ? Math.max(0, 8 - Math.abs(stamp.hour - 12)) * 8 : 0;
    solar[stamp.index] = sun;
  }
  return {
    load_kwh: load,
    solar_kwh: solar,
    rate: syntheticRate(),
    batteries: syntheticBatteries(),
    billed_peak_kw: new Array<number>(12).fill(140),
  };
}

export function syntheticRate(): RateModel {
  return {
    id: "synthetic-example",
    name: "Synthetic example rate (not a utility tariff)",
    seasons: [{ id: "all", start_month: 1, end_month: 12 }],
    energy_periods: [
      {
        name: "Off-peak",
        weekday_hours: hoursBetween(0, 16).map((on, hour) => on || hour >= 21),
        weekend_hours: ALL_HOURS,
        energy_rate_kwh: 0.08,
      },
      {
        name: "On-peak",
        weekday_hours: hoursBetween(16, 21),
        weekend_hours: NO_HOURS,
        energy_rate_kwh: 0.3,
      },
    ],
    demand_components: [
      {
        name: "Facilities",
        is_facilities: true,
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        demand_rate_kw: 10,
      },
      {
        name: "On-peak demand",
        is_facilities: false,
        weekday_hours: hoursBetween(16, 21),
        weekend_hours: NO_HOURS,
        demand_rate_kw: 8,
      },
    ],
    fixed_monthly_charge: 50,
    export_credit_kwh: 0.03,
  };
}

export function syntheticBatteries(): Battery[] {
  return [
    {
      id: "small",
      name: "Example Small cabinet",
      usable_capacity_kwh: 50,
      max_charge_rate_kw: 25,
      max_discharge_rate_kw: 25,
      cost_per_unit: 28000,
      cost_per_additional_unit: 22000,
      round_trip_efficiency: 0.9,
      degradation_per_year: 0.02,
    },
    {
      id: "medium",
      name: "Example Medium cabinet",
      usable_capacity_kwh: 100,
      max_charge_rate_kw: 50,
      max_discharge_rate_kw: 50,
      cost_per_unit: 48000,
      cost_per_additional_unit: 36000,
      round_trip_efficiency: 0.9,
      degradation_per_year: 0.02,
    },
    {
      id: "large",
      name: "Example Large cabinet",
      usable_capacity_kwh: 200,
      max_charge_rate_kw: 100,
      max_discharge_rate_kw: 100,
      cost_per_unit: 86000,
      cost_per_additional_unit: 64000,
      round_trip_efficiency: 0.9,
      degradation_per_year: 0.02,
    },
  ];
}
