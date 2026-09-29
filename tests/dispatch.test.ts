import { describe, expect, it } from "vitest";
import { BILLED_PEAK_SCALE_CAVEAT, HOURLY_DEMAND_CAVEAT } from "../src/dispatch/assumptions";
import { hourlyPrices, priceYear } from "../src/dispatch/bill";
import {
  ALL_HOURS,
  HOURS_PER_YEAR,
  NO_HOURS,
  buildCalendar,
  hourMask,
  hoursBetween,
  monthInSeason,
} from "../src/dispatch/calendar";
import { rmpSchedule6Rate } from "../src/dispatch/rmp-schedule-6";
import { simulateDispatch } from "../src/dispatch/simulate";
import type { Battery, DispatchStrategy, RateModel } from "../src/dispatch/types";
import { demandRate } from "../src/sizing/tariff";

const calendar = buildCalendar(1);

function zeros(): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(0);
}

function filled(value: number): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(value);
}

function battery(overrides: Partial<Battery> = {}): Battery {
  return {
    id: "pack",
    name: "Test pack",
    usable_capacity_kwh: 40,
    max_charge_rate_kw: 20,
    max_discharge_rate_kw: 20,
    cost_per_unit: 12000,
    cost_per_additional_unit: 9000,
    round_trip_efficiency: 1,
    degradation_per_year: 0,
    ...overrides,
  };
}

function flatRate(overrides: Partial<RateModel> = {}): RateModel {
  return {
    id: "synthetic",
    name: "Synthetic test rate",
    seasons: [
      { id: "summer", start_month: 6, end_month: 9 },
      { id: "winter", start_month: 10, end_month: 5 },
    ],
    energy_periods: [
      {
        name: "All hours",
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        energy_rate_kwh: 0.1,
      },
    ],
    demand_components: [],
    fixed_monthly_charge: 0,
    export_credit_kwh: 0,
    ...overrides,
  };
}

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return total;
}

describe("calendar", () => {
  it("maps a non-leap year onto 8760 hours starting Monday", () => {
    expect(calendar).toHaveLength(HOURS_PER_YEAR);
    expect(calendar[0]).toMatchObject({ month: 1, hour: 0, weekday: 1, isWeekend: false });
    expect(calendar[5 * 24]).toMatchObject({ weekday: 6, isWeekend: true });
    expect(calendar[6 * 24]).toMatchObject({ weekday: 0, isWeekend: true });
    expect(calendar[7 * 24]).toMatchObject({ weekday: 1, isWeekend: false });
    expect(calendar[HOURS_PER_YEAR - 1]).toMatchObject({ month: 12, hour: 23 });
    expect(monthInSeason(1, 10, 5)).toBe(true);
    expect(monthInSeason(7, 10, 5)).toBe(false);
    expect(monthInSeason(6, 6, 9)).toBe(true);
  });
});

describe("hourly bill", () => {
  it("prices stacked energy, seasonal rates, facilities, and windowed demand", () => {
    const rate = flatRate({
      energy_periods: [
        {
          name: "Delivery",
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          energy_rate_kwh: 0.02,
        },
        {
          name: "Winter energy",
          season_ids: ["winter"],
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          energy_rate_kwh: 0.1,
        },
        {
          name: "Summer energy",
          season_ids: ["summer"],
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          energy_rate_kwh: 0.5,
        },
        {
          name: "Weekday on-peak adder",
          weekday_hours: hoursBetween(16, 21),
          weekend_hours: NO_HOURS,
          energy_rate_kwh: 0.3,
          export_rate_kwh: 0.04,
        },
      ],
      demand_components: [
        {
          name: "Facilities",
          is_facilities: true,
          weekday_hours: NO_HOURS,
          weekend_hours: NO_HOURS,
          demand_rate_kw: 2,
        },
        {
          name: "Weekday on-peak",
          is_facilities: false,
          weekday_hours: hoursBetween(16, 21),
          weekend_hours: NO_HOURS,
          demand_rate_kw: 10,
        },
      ],
      fixed_monthly_charge: 5,
      export_credit_kwh: 0.01,
    });
    const imports = zeros();
    const exports = zeros();
    imports[0] = 100;
    imports[16] = 3;
    imports[5 * 24 + 16] = 50;
    const june = calendar.findIndex((stamp) => stamp.month === 6 && stamp.hour === 0);
    imports[june] = 1;
    exports[1] = 10;
    exports[16] = 4;

    const prices = hourlyPrices(rate, calendar);
    expect(prices.importRate[0]).toBeCloseTo(0.12);
    expect(prices.importRate[16]).toBeCloseTo(0.42);
    expect(prices.importRate[june]).toBeCloseTo(0.52);
    expect(prices.exportRate[1]).toBeCloseTo(0.01);
    expect(prices.exportRate[16]).toBeCloseTo(0.04);

    const bill = priceYear({
      rate,
      calendar,
      gridImportKwh: imports,
      gridExportKwh: exports,
      importRate: prices.importRate,
      exportRate: prices.exportRate,
      scales: new Array<number>(12).fill(1),
      unpricedHours: prices.unpricedHours,
      demandCaveat: "hourly",
    });

    const january = bill.months[0];
    expect(january.energy_usd).toBeCloseTo(100 * 0.12 + 3 * 0.42 + 50 * 0.12);
    expect(january.export_credit_usd).toBeCloseTo(10 * 0.01 + 4 * 0.04);
    const facilities = january.demand_lines.find((line) => line.name === "Facilities");
    const onPeak = january.demand_lines.find((line) => line.name === "Weekday on-peak");
    expect(facilities?.peak_kw).toBe(100);
    expect(facilities?.usd).toBeCloseTo(200);
    expect(onPeak?.peak_kw).toBe(3);
    expect(onPeak?.usd).toBeCloseTo(30);
    expect(january.fixed_usd).toBe(5);
    expect(bill.months[5].energy_usd).toBeCloseTo(0.52);
    expect(bill.warnings.some((warning) => warning.includes("hourly average"))).toBe(true);
    expect(bill.warnings.join(" ")).toContain(HOURLY_DEMAND_CAVEAT.slice(0, 24));
  });

  it("applies the minimum bill before tax and does not tax a negative subtotal", () => {
    const rate = flatRate({
      energy_periods: [
        {
          name: "Energy",
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          energy_rate_kwh: 0.1,
        },
      ],
      min_bill_usd: 10,
      tax_rate: 0.1,
      export_credit_kwh: 1,
    });
    const prices = hourlyPrices(rate, calendar);
    const small = zeros();
    small[0] = 1;
    const priced = priceYear({
      rate,
      calendar,
      gridImportKwh: small,
      gridExportKwh: zeros(),
      importRate: prices.importRate,
      exportRate: prices.exportRate,
      scales: new Array<number>(12).fill(1),
      unpricedHours: 0,
      demandCaveat: "none",
    });
    expect(priced.months[0].pre_min_usd).toBeCloseTo(0.1);
    expect(priced.months[0].min_bill_applied).toBe(true);
    expect(priced.months[0].tax_usd).toBeCloseTo(1);
    expect(priced.months[0].total_usd).toBeCloseTo(11);
    expect(priced.months[1].pre_min_usd).toBeCloseTo(0);
    expect(priced.months[1].total_usd).toBeCloseTo(11);

    const exporting = zeros();
    exporting[0] = 40;
    const credit = priceYear({
      rate,
      calendar,
      gridImportKwh: zeros(),
      gridExportKwh: exporting,
      importRate: prices.importRate,
      exportRate: prices.exportRate,
      scales: new Array<number>(12).fill(1),
      unpricedHours: 0,
      demandCaveat: "none",
    });
    expect(credit.months[0].pre_min_usd).toBeCloseTo(-40);
    expect(credit.months[0].min_bill_applied).toBe(true);
    expect(credit.months[0].total_usd).toBeCloseTo(11);
  });

  it("scales every demand window by billed peak over the hourly peak", () => {
    const rate = flatRate({
      energy_periods: [],
      demand_components: [
        {
          name: "Facilities",
          is_facilities: true,
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          demand_rate_kw: 2,
        },
        {
          name: "On-peak",
          is_facilities: false,
          weekday_hours: hoursBetween(16, 21),
          weekend_hours: NO_HOURS,
          demand_rate_kw: 5,
        },
      ],
    });
    const imports = filled(10);
    const prices = hourlyPrices(rate, calendar);
    const bill = priceYear({
      rate,
      calendar,
      gridImportKwh: imports,
      gridExportKwh: zeros(),
      importRate: prices.importRate,
      exportRate: prices.exportRate,
      scales: new Array<number>(12).fill(1.5),
      unpricedHours: 0,
      demandCaveat: "scaled",
    });
    expect(bill.months[0].demand_lines[0].peak_kw).toBe(10);
    expect(bill.months[0].demand_lines[0].assessed_kw).toBeCloseTo(15);
    expect(bill.months[0].demand_lines[0].usd).toBeCloseTo(30);
    expect(bill.months[0].demand_lines[1].assessed_kw).toBeCloseTo(15);
    expect(bill.months[0].demand_usd).toBeCloseTo(30 + 75);
    expect(bill.warnings[0]).toBe(BILLED_PEAK_SCALE_CAVEAT);
  });
});

describe("dispatch", () => {
  const strategies: DispatchStrategy[] = [
    "demand_peak_shave",
    "tou_arbitrage",
    "solar_self_consumption",
    "combined",
  ];

  function variedYear(): { load: number[]; solar: number[] } {
    let seed = 7;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const load: number[] = [];
    const solar: number[] = [];
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      const hourOfDay = hour % 24;
      const base = 18 + 8 * Math.sin(((hourOfDay - 7) / 24) * Math.PI * 2);
      load.push(Math.max(0, base + next() * 4));
      const sun = hourOfDay >= 8 && hourOfDay <= 16 ? Math.max(0, 4 - Math.abs(hourOfDay - 12)) * 3 : 0;
      solar.push(sun);
    }
    return { load, solar };
  }

  it("conserves energy, stays inside power and SOC limits, and does not export the battery", () => {
    const { load, solar } = variedYear();
    const pack = battery({
      usable_capacity_kwh: 30,
      max_charge_rate_kw: 10,
      max_discharge_rate_kw: 8,
      round_trip_efficiency: 0.81,
    });
    for (const strategy of strategies) {
      const result = simulateDispatch({
        load_kwh: load,
        solar_kwh: solar,
        rate: flatRate(),
        battery: pack,
        quantity: 2,
        strategy,
      });
      const hourly = result.hourly;
      if (!hourly) throw new Error("expected hourly dispatch");
      const eta = Math.sqrt(0.81);
      const socDelta = result.totals.soc_end_kwh - result.totals.soc_start_kwh;
      const throughput = result.totals.charge_ac_kwh * eta - result.totals.discharge_ac_kwh / eta;
      expect(socDelta).toBeCloseTo(throughput, 6);
      const gridGap =
        result.totals.grid_import_kwh -
        result.totals.grid_export_kwh -
        (result.totals.load_kwh - result.totals.solar_kwh + result.totals.charge_ac_kwh - result.totals.discharge_ac_kwh);
      expect(gridGap).toBeCloseTo(0, 6);
      for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
        expect(hourly.charge_ac_kwh[hour]).toBeLessThanOrEqual(20 + 1e-9);
        expect(hourly.discharge_ac_kwh[hour]).toBeLessThanOrEqual(16 + 1e-9);
        expect(hourly.soc_end_kwh[hour]).toBeGreaterThanOrEqual(-1e-6);
        expect(hourly.soc_end_kwh[hour]).toBeLessThanOrEqual(60 + 1e-6);
        expect(hourly.charge_ac_kwh[hour] * hourly.discharge_ac_kwh[hour]).toBeLessThan(1e-8);
        const excess = Math.max(0, solar[hour] - load[hour]);
        expect(hourly.grid_export_kwh[hour]).toBeLessThanOrEqual(excess + 1e-6);
      }
    }
  });

  it("loses the round trip when a cheap charge is discharged at the peak price", () => {
    const load = filled(10);
    const rate = flatRate({
      energy_periods: [
        {
          name: "Cheap",
          weekday_hours: hoursBetween(0, 6),
          weekend_hours: hoursBetween(0, 6),
          energy_rate_kwh: 0.01,
        },
        {
          name: "Expensive",
          weekday_hours: hoursBetween(16, 21),
          weekend_hours: hoursBetween(16, 21),
          energy_rate_kwh: 1,
        },
        {
          name: "Shoulder",
          weekday_hours: hourMask((hour) => (hour >= 6 && hour < 16) || hour >= 21),
          weekend_hours: hourMask((hour) => (hour >= 6 && hour < 16) || hour >= 21),
          energy_rate_kwh: 0.1,
        },
      ],
    });
    const result = simulateDispatch({
      load_kwh: load,
      rate,
      battery: battery({
        usable_capacity_kwh: 50,
        max_charge_rate_kw: 25,
        max_discharge_rate_kw: 25,
        round_trip_efficiency: 0.81,
      }),
      quantity: 1,
      strategy: "tou_arbitrage",
    });
    const hourly = result.hourly;
    if (!hourly) throw new Error("expected hourly dispatch");
    const eta = 0.9;
    const socDelta = result.totals.soc_end_kwh - result.totals.soc_start_kwh;
    expect(socDelta).toBeCloseTo(result.totals.charge_ac_kwh * eta - result.totals.discharge_ac_kwh / eta, 5);
    expect(result.totals.discharge_ac_kwh).toBeGreaterThan(1000);
    expect(result.totals.discharge_ac_kwh).toBeLessThan(result.totals.charge_ac_kwh * 0.81 + result.totals.soc_end_kwh * eta + 1e-6);
    expect(hourly.charge_ac_kwh[1]).toBeGreaterThan(0);
    expect(hourly.discharge_ac_kwh[16]).toBeGreaterThan(0);
    expect(hourly.charge_ac_kwh[12]).toBe(0);
    expect(result.annual_savings_usd).toBeGreaterThan(0);
  });

  it("shaves a daily spike down to the energy-limited flat cap", () => {
    const load = zeros();
    for (let day = 0; day < 365; day += 1) load[day * 24 + 18] = 30;
    const rate = flatRate({
      energy_periods: [],
      demand_components: [
        {
          name: "Facilities",
          is_facilities: true,
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          demand_rate_kw: 10,
        },
      ],
    });
    const result = simulateDispatch({
      load_kwh: load,
      rate,
      battery: battery({
        usable_capacity_kwh: 30,
        max_charge_rate_kw: 30,
        max_discharge_rate_kw: 30,
        round_trip_efficiency: 1,
      }),
      quantity: 1,
      strategy: "demand_peak_shave",
    });
    const expectedCap = 30 / 19;
    expect(result.monthly_peak_kw.baseline[0]).toBe(30);
    expect(result.monthly_peak_kw.with_battery[0]).toBeCloseTo(expectedCap, 2);
    expect(result.demand_threshold_kw[0]).toBeCloseTo(expectedCap, 2);
    expect(result.baseline.months[0].demand_usd).toBeCloseTo(300);
    expect(result.with_battery.months[0].demand_usd).toBeCloseTo(expectedCap * 10, 1);
    expect(result.annual_savings_usd).toBeGreaterThan(3000);
    expect(result.warnings.some((warning) => warning.includes("hourly average"))).toBe(true);
  });

  it("refuses to charge from the grid when the strategy is self-consumption", () => {
    const load = filled(5);
    const solar = zeros();
    for (let day = 0; day < 365; day += 1) {
      for (let hour = 10; hour <= 15; hour += 1) solar[day * 24 + hour] = 10;
    }
    const result = simulateDispatch({
      load_kwh: load,
      solar_kwh: solar,
      rate: flatRate({ export_credit_kwh: 0.02 }),
      battery: battery({
        usable_capacity_kwh: 10,
        max_charge_rate_kw: 5,
        max_discharge_rate_kw: 5,
        round_trip_efficiency: 1,
      }),
      quantity: 1,
      strategy: "solar_self_consumption",
    });
    const hourly = result.hourly;
    if (!hourly) throw new Error("expected hourly dispatch");
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      const excess = Math.max(0, solar[hour] - load[hour]);
      expect(hourly.charge_ac_kwh[hour]).toBeLessThanOrEqual(excess + 1e-6);
    }
    expect(result.totals.charge_ac_kwh).toBeGreaterThan(3000);
    expect(result.totals.grid_export_kwh).toBeLessThan(sum(solar) - sum(load.map((value, hour) => Math.min(value, solar[hour]))));
    const baselineExport = result.baseline.export_credit_usd;
    expect(result.with_battery.export_credit_usd).toBeLessThan(baselineExport);
    expect(result.annual_savings_usd).toBeGreaterThan(0);
  });

  it("holds the demand cap and still shifts leftover energy into the expensive hours", () => {
    const load = filled(10);
    for (let day = 0; day < 365; day += 1) load[day * 24 + 18] = 100;
    const rate = flatRate({
      energy_periods: [
        {
          name: "Cheap",
          weekday_hours: hoursBetween(0, 6),
          weekend_hours: hoursBetween(0, 6),
          energy_rate_kwh: 0.02,
        },
        {
          name: "Expensive",
          weekday_hours: hoursBetween(16, 21),
          weekend_hours: hoursBetween(16, 21),
          energy_rate_kwh: 0.9,
        },
        {
          name: "Shoulder",
          weekday_hours: hourMask((hour) => (hour >= 6 && hour < 16) || hour >= 21),
          weekend_hours: hourMask((hour) => (hour >= 6 && hour < 16) || hour >= 21),
          energy_rate_kwh: 0.1,
        },
      ],
      demand_components: [
        {
          name: "Facilities",
          is_facilities: true,
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          demand_rate_kw: 1,
        },
      ],
    });
    const pack = battery({
      usable_capacity_kwh: 200,
      max_charge_rate_kw: 20,
      max_discharge_rate_kw: 20,
      round_trip_efficiency: 1,
    });
    const shared = { load_kwh: load, rate, battery: pack, quantity: 1 as const };
    const demand = simulateDispatch({ ...shared, strategy: "demand_peak_shave" });
    const combined = simulateDispatch({ ...shared, strategy: "combined" });
    for (let month = 0; month < 12; month += 1) {
      expect(combined.monthly_peak_kw.with_battery[month]).toBeLessThanOrEqual(
        (combined.demand_threshold_kw[month] ?? 0) + 0.05,
      );
    }
    expect(combined.monthly_peak_kw.with_battery[0]).toBeLessThan(combined.monthly_peak_kw.baseline[0]);
    expect(combined.totals.discharge_ac_kwh).toBeGreaterThan(demand.totals.discharge_ac_kwh + 1000);
    expect(combined.annual_savings_usd).toBeGreaterThan(demand.annual_savings_usd);
  });

  it("scales demand savings from an optional billed monthly peak", () => {
    const load = filled(10);
    for (let day = 0; day < 365; day += 1) load[day * 24 + 12] = 20;
    const rate = flatRate({
      energy_periods: [],
      demand_components: [
        {
          name: "Facilities",
          is_facilities: true,
          weekday_hours: ALL_HOURS,
          weekend_hours: ALL_HOURS,
          demand_rate_kw: 10,
        },
      ],
    });
    const result = simulateDispatch({
      load_kwh: load,
      rate,
      battery: battery({
        usable_capacity_kwh: 40,
        max_charge_rate_kw: 20,
        max_discharge_rate_kw: 20,
        round_trip_efficiency: 1,
      }),
      quantity: 1,
      strategy: "demand_peak_shave",
      billed_peak_kw: new Array<number>(12).fill(30),
    });
    expect(result.monthly_peak_kw.baseline[0]).toBe(20);
    expect(result.baseline.months[0].demand_lines[0].assessed_kw).toBeCloseTo(30);
    expect(result.baseline.months[0].demand_usd).toBeCloseTo(300);
    const shaved = result.monthly_peak_kw.with_battery[0];
    expect(shaved).toBeLessThan(20);
    expect(result.with_battery.months[0].demand_lines[0].assessed_kw).toBeCloseTo(shaved * (30 / 20), 4);
    expect(result.warnings[0]).toBe(BILLED_PEAK_SCALE_CAVEAT);
    expect(result.annual_savings_usd).toBeCloseTo(result.baseline.total_usd - result.with_battery.total_usd, 6);
  });

  it("does not invent savings on a flat load with a flat price", () => {
    const result = simulateDispatch({
      load_kwh: filled(10),
      rate: flatRate(),
      battery: battery(),
      quantity: 1,
      strategy: "combined",
    });
    expect(result.annual_savings_usd).toBeCloseTo(0, 6);
    expect(result.totals.charge_ac_kwh).toBeCloseTo(0, 6);
  });

  it("rejects a series that is not a full year", () => {
    expect(() =>
      simulateDispatch({
        load_kwh: [1, 2, 3],
        rate: flatRate(),
        battery: battery(),
        quantity: 1,
        strategy: "solar_self_consumption",
      }),
    ).toThrow(/8760/);
  });
});

describe("RMP Schedule 6 example rate", () => {
  it("uses the stamped worksheet rates and is not assumed by the engine", () => {
    const rate = rmpSchedule6Rate();
    expect(rate.fixed_monthly_charge).toBe(58);
    const summer = rate.demand_components.find((component) => component.name === "Summer power");
    const winter = rate.demand_components.find((component) => component.name === "Winter power");
    const facilities = rate.demand_components.find((component) => component.name === "Facilities");
    expect(facilities?.demand_rate_kw).toBe(demandRate("summer").facilitiesUsdPerKw);
    expect(summer?.demand_rate_kw).toBe(demandRate("summer").powerUsdPerKw);
    expect(winter?.demand_rate_kw).toBe(demandRate("winter").powerUsdPerKw);
    expect(summer?.demand_rate_kw).toBeCloseTo(14.49);
    expect(winter?.demand_rate_kw).toBeCloseTo(12.82);
  });
});
