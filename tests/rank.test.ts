import { describe, expect, it } from "vitest";
import { ALL_HOURS, HOURS_PER_YEAR } from "../src/dispatch/calendar";
import {
  DEFAULT_ANALYSIS_YEARS,
  installedCost,
  internalRateOfReturn,
  netPresentValue,
  savingsCashFlows,
  simplePaybackYears,
} from "../src/dispatch/economics";
import {
  BACKUP_DURATION,
  BEST_PAYBACK,
  CHEAPEST_PEAK_TARGET,
  MAX_ANNUAL_SAVINGS,
  MAX_LIFETIME_NPV,
  MAX_SELF_CONSUMPTION,
  batteryMissesConstraint,
  bestQuantityForBattery,
  constraintMissLabel,
  rankCandidates,
  rankingMode,
  sweepBatteries,
  type CandidateMetrics,
} from "../src/dispatch/rank";
import { simulateDispatch } from "../src/dispatch/simulate";
import type { Battery, RateModel } from "../src/dispatch/types";

function zeros(): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(0);
}

function battery(overrides: Partial<Battery> = {}): Battery {
  return {
    id: "pack",
    name: "Pack",
    usable_capacity_kwh: 30,
    max_charge_rate_kw: 30,
    max_discharge_rate_kw: 30,
    cost_per_unit: 10000,
    cost_per_additional_unit: 7000,
    round_trip_efficiency: 1,
    degradation_per_year: 0,
    ...overrides,
  };
}

function demandRate(): RateModel {
  return {
    name: "Synthetic demand",
    seasons: [],
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
    fixed_monthly_charge: 0,
    export_credit_kwh: 0,
  };
}

function candidate(overrides: Partial<CandidateMetrics> & Pick<CandidateMetrics, "battery">): CandidateMetrics {
  return {
    quantity: 1,
    strategy: "combined",
    installed_cost_usd: 10000,
    annual_savings_usd: 1000,
    simple_payback_years: 10,
    npv_usd: 500,
    irr: 0.08,
    peak_reduction_kw: 0,
    monthly_peak_reduction_kw: new Array<number>(12).fill(0),
    self_consumption_pct: null,
    equivalent_cycles: 0,
    backup_hours: null,
    warnings: [],
    ...overrides,
  };
}

function ids(ranked: CandidateMetrics[]): string[] {
  return ranked.map((entry) => entry.battery.id);
}

describe("cash flows", () => {
  it("prices the first unit separately, degrades savings, and solves a conventional IRR", () => {
    expect(installedCost(battery(), 1)).toBe(10000);
    expect(installedCost(battery(), 3)).toBe(10000 + 7000 * 2);
    expect(simplePaybackYears(10000, 2500)).toBe(4);
    expect(simplePaybackYears(10000, 0)).toBeNull();
    expect(simplePaybackYears(0, 100)).toBe(0);

    const flat = savingsCashFlows({
      installedCostUsd: 1000,
      annualSavingsUsd: 100,
      degradationPerYear: 0,
      rateEscalator: 0,
      analysisYears: DEFAULT_ANALYSIS_YEARS,
    });
    expect(flat).toHaveLength(26);
    expect(flat[1]).toBe(100);
    expect(flat[25]).toBe(100);

    const faded = savingsCashFlows({
      installedCostUsd: 0,
      annualSavingsUsd: 1000,
      degradationPerYear: 0.5,
      rateEscalator: 0.1,
      analysisYears: 2,
    });
    expect(faded[1]).toBe(1000);
    expect(faded[2]).toBeCloseTo(1000 * 0.5 * 1.1);

    const undiscounted = netPresentValue(0, faded);
    expect(undiscounted).toBeCloseTo(1000 + 550);
    const withFade = netPresentValue(
      0,
      savingsCashFlows({
        installedCostUsd: 0,
        annualSavingsUsd: 1000,
        degradationPerYear: 0.5,
        rateEscalator: 0,
        analysisYears: 2,
      }),
    );
    const withoutFade = netPresentValue(
      0,
      savingsCashFlows({
        installedCostUsd: 0,
        annualSavingsUsd: 1000,
        degradationPerYear: 0,
        rateEscalator: 0,
        analysisYears: 2,
      }),
    );
    expect(withFade).toBeLessThan(withoutFade);

    const flows = [-100, 60, 60];
    const irr = internalRateOfReturn(flows);
    expect(irr).not.toBeNull();
    expect(netPresentValue(irr ?? 0, flows)).toBeCloseTo(0, 4);
    expect(internalRateOfReturn([-100, -5, -5])).toBeNull();
    expect(internalRateOfReturn([0, 10, 10])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ranking modes", () => {
  const packs = {
    big: candidate({
      battery: battery({ id: "big", name: "Big" }),
      annual_savings_usd: 5000,
      installed_cost_usd: 20000,
      simple_payback_years: 4,
      npv_usd: 1000,
      irr: 0.1,
      peak_reduction_kw: 80,
      self_consumption_pct: 0.4,
      backup_hours: 5,
    }),
    cheap: candidate({
      battery: battery({ id: "cheap", name: "Cheap" }),
      annual_savings_usd: 2000,
      installed_cost_usd: 4000,
      simple_payback_years: 2,
      npv_usd: 3000,
      irr: 0.3,
      peak_reduction_kw: 30,
      self_consumption_pct: 0.9,
      backup_hours: 6,
    }),
    miss: candidate({
      battery: battery({ id: "miss", name: "Miss" }),
      annual_savings_usd: 100,
      installed_cost_usd: 1000,
      simple_payback_years: null,
      npv_usd: -500,
      irr: null,
      peak_reduction_kw: 10,
      self_consumption_pct: null,
      backup_hours: 1,
    }),
  };
  const list = [packs.big, packs.cheap, packs.miss];

  it("picks the largest annual savings by default", () => {
    expect(ids(rankCandidates(list))).toEqual(["big", "cheap", "miss"]);
    expect(ids(rankCandidates(list, MAX_ANNUAL_SAVINGS))).toEqual(["big", "cheap", "miss"]);
    expect(rankingMode("max_annual_savings").id).toBe(MAX_ANNUAL_SAVINGS.id);
  });

  it("picks the shortest payback, then the higher IRR", () => {
    expect(ids(rankCandidates(list, BEST_PAYBACK))).toEqual(["cheap", "big", "miss"]);
    const tied = [
      candidate({ battery: battery({ id: "low-irr" }), simple_payback_years: 4, irr: 0.1, installed_cost_usd: 1 }),
      candidate({ battery: battery({ id: "high-irr" }), simple_payback_years: 4, irr: 0.4, installed_cost_usd: 9 }),
    ];
    expect(ids(rankCandidates(tied, BEST_PAYBACK))).toEqual(["high-irr", "low-irr"]);
  });

  it("picks the highest lifetime NPV", () => {
    expect(ids(rankCandidates(list, MAX_LIFETIME_NPV))).toEqual(["cheap", "big", "miss"]);
  });

  it("picks the highest solar self-consumption and puts a site with no solar last", () => {
    expect(ids(rankCandidates(list, MAX_SELF_CONSUMPTION))).toEqual(["cheap", "big", "miss"]);
  });

  it("picks the cheapest stack that hits the peak-kW target", () => {
    expect(ids(rankCandidates(list, CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 50 }))).toEqual([
      "big",
      "cheap",
      "miss",
    ]);
    const under = [
      candidate({ battery: battery({ id: "closer" }), peak_reduction_kw: 40, installed_cost_usd: 9000 }),
      candidate({ battery: battery({ id: "short" }), peak_reduction_kw: 15, installed_cost_usd: 1000 }),
    ];
    expect(ids(rankCandidates(under, CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 100 }))).toEqual([
      "closer",
      "short",
    ]);
    expect(() => rankCandidates(list, CHEAPEST_PEAK_TARGET)).toThrow(/peak-kW/);
  });

  it("picks the cheapest stack that covers the backup-hour target", () => {
    expect(ids(rankCandidates(list, BACKUP_DURATION, { backup_target_hours: 4 }))).toEqual(["cheap", "big", "miss"]);
    const short = [
      candidate({ battery: battery({ id: "longer" }), backup_hours: 3, installed_cost_usd: 5000 }),
      candidate({ battery: battery({ id: "shorter" }), backup_hours: 1, installed_cost_usd: 100 }),
    ];
    expect(ids(rankCandidates(short, BACKUP_DURATION, { backup_target_hours: 8 }))).toEqual(["longer", "shorter"]);
    expect(() => rankCandidates(list, BACKUP_DURATION)).toThrow(/backup/);
  });

  it("defaults a battery to its best viable quantity, or 1 when none qualify", () => {
    const ranked = rankCandidates(
      [
        candidate({
          battery: battery({ id: "a" }),
          quantity: 1,
          peak_reduction_kw: 10,
          installed_cost_usd: 100,
          annual_savings_usd: 10,
        }),
        candidate({
          battery: battery({ id: "a" }),
          quantity: 2,
          peak_reduction_kw: 40,
          installed_cost_usd: 200,
          annual_savings_usd: 50,
        }),
        candidate({
          battery: battery({ id: "a" }),
          quantity: 3,
          peak_reduction_kw: 50,
          installed_cost_usd: 150,
          annual_savings_usd: 40,
        }),
      ],
      CHEAPEST_PEAK_TARGET,
      { target_peak_reduction_kw: 30 },
    );
    expect(bestQuantityForBattery(ranked, "a", CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 30 })).toBe(3);
    expect(constraintMissLabel(ranked.find((row) => row.quantity === 1)!, CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 30 })).toMatch(
      /peak target/,
    );
    expect(batteryMissesConstraint(ranked, "a", CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 30 })).toBe(false);

    const missed = rankCandidates(
      [
        candidate({ battery: battery({ id: "short" }), quantity: 2, peak_reduction_kw: 5, backup_hours: 1 }),
        candidate({ battery: battery({ id: "short" }), quantity: 1, peak_reduction_kw: 4, backup_hours: 1 }),
      ],
      CHEAPEST_PEAK_TARGET,
      { target_peak_reduction_kw: 30 },
    );
    expect(bestQuantityForBattery(missed, "short", CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 30 })).toBe(1);
    expect(batteryMissesConstraint(missed, "short", CHEAPEST_PEAK_TARGET, { target_peak_reduction_kw: 30 })).toBe(true);

    const bySavings = rankCandidates(
      [
        candidate({ battery: battery({ id: "a" }), quantity: 1, annual_savings_usd: 10 }),
        candidate({ battery: battery({ id: "a" }), quantity: 2, annual_savings_usd: 50 }),
      ],
      MAX_ANNUAL_SAVINGS,
    );
    expect(bestQuantityForBattery(bySavings, "a", MAX_ANNUAL_SAVINGS, {})).toBe(2);
  });

  it("accepts a caller-supplied mode", () => {
    const byQuantity: typeof MAX_ANNUAL_SAVINGS = {
      id: "quantity",
      label: "Quantity",
      description: "More units first.",
      compare: (a, b) => b.quantity - a.quantity,
    };
    const ranked = rankCandidates(
      [
        candidate({ battery: battery({ id: "one" }), quantity: 1 }),
        candidate({ battery: battery({ id: "three" }), quantity: 3 }),
      ],
      byQuantity,
    );
    expect(ids(ranked)).toEqual(["three", "one"]);
    expect(() => rankingMode("nope")).toThrow(/Unknown ranking mode/);
  });
});

describe("sweep", () => {
  it("simulates each quantity and reports payback, peak reduction, cycles, and backup", () => {
    const load = zeros();
    for (let day = 0; day < 365; day += 1) load[day * 24 + 18] = 30;
    const pack = battery();
    const swept = sweepBatteries({
      load_kwh: load,
      rate: demandRate(),
      batteries: [pack],
      max_quantity: 2,
      strategy: "demand_peak_shave",
      discount_rate: 0,
      rate_escalator: 0,
      analysis_years: 10,
      critical_load_kw: 10,
    });
    expect(swept).toHaveLength(2);
    expect(swept[0].quantity).toBe(1);
    expect(swept[0].installed_cost_usd).toBe(10000);
    expect(swept[1].installed_cost_usd).toBe(17000);
    expect(swept[0].annual_savings_usd).toBeGreaterThan(3000);
    expect(swept[0].simple_payback_years).toBeCloseTo(10000 / swept[0].annual_savings_usd, 6);
    expect(swept[0].npv_usd).toBeCloseTo(-10000 + swept[0].annual_savings_usd * 10, 4);
    expect(swept[0].irr).not.toBeNull();
    expect(netPresentValue(swept[0].irr ?? 0, savingsCashFlows({
      installedCostUsd: swept[0].installed_cost_usd,
      annualSavingsUsd: swept[0].annual_savings_usd,
      degradationPerYear: 0,
      rateEscalator: 0,
      analysisYears: 10,
    }))).toBeCloseTo(0, 2);
    expect(swept[0].peak_reduction_kw).toBeGreaterThan(20);
    expect(swept[0].backup_hours).toBeCloseTo(3);
    expect(swept[1].backup_hours).toBeCloseTo(6);

    const single = simulateDispatch({
      load_kwh: load,
      rate: demandRate(),
      battery: pack,
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    expect(swept[0].equivalent_cycles).toBeCloseTo(single.totals.discharge_ac_kwh / pack.usable_capacity_kwh, 6);
    expect(swept[0].self_consumption_pct).toBeNull();

    const overloaded = sweepBatteries({
      load_kwh: load,
      rate: demandRate(),
      batteries: [pack],
      max_quantity: 1,
      strategy: "demand_peak_shave",
      critical_load_kw: 100,
      analysis_years: 1,
      discount_rate: 0,
      rate_escalator: 0,
    });
    expect(overloaded[0].backup_hours).toBe(0);
  });

  it("raises solar self-consumption above the no-battery share", () => {
    const load = new Array<number>(HOURS_PER_YEAR).fill(5);
    const solar = zeros();
    for (let day = 0; day < 365; day += 1) {
      for (let hour = 10; hour <= 15; hour += 1) solar[day * 24 + hour] = 10;
    }
    const swept = sweepBatteries({
      load_kwh: load,
      solar_kwh: solar,
      rate: {
        name: "Synthetic energy",
        seasons: [],
        energy_periods: [
          {
            name: "Flat",
            weekday_hours: ALL_HOURS,
            weekend_hours: ALL_HOURS,
            energy_rate_kwh: 0.1,
          },
        ],
        demand_components: [],
        fixed_monthly_charge: 0,
        export_credit_kwh: 0.02,
      },
      batteries: [battery({ usable_capacity_kwh: 10, max_charge_rate_kw: 5, max_discharge_rate_kw: 5 })],
      max_quantity: 1,
      strategy: "solar_self_consumption",
      discount_rate: 0.06,
      rate_escalator: 0.02,
    });
    expect(swept[0].self_consumption_pct).toBeGreaterThan(0.5);
    expect(swept[0].self_consumption_pct).toBeLessThanOrEqual(1);
    expect(swept[0].equivalent_cycles).toBeGreaterThan(50);
  });
});
