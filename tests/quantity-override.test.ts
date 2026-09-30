import { describe, expect, it } from "vitest";
import { ALL_HOURS, HOURS_PER_YEAR } from "../src/dispatch/calendar";
import { installedCost } from "../src/dispatch/economics";
import {
  CONTIGUOUS_EXTRA_BUDGET,
  MAX_ANNUAL_SAVINGS,
  OVERRIDE_QUANTITY_CAP,
  OVERRIDE_QUANTITY_FLOOR,
  evaluateCandidate,
  overrideQuantityMax,
  planContiguousQuantities,
  quantityChoicesForBattery,
  sweepBatteries,
  type CandidateEvalInput,
  type CandidateMetrics,
} from "../src/dispatch/rank";
import type { Battery, RateModel } from "../src/dispatch/types";
import { cachedCandidate, comparisonRows, rankSweep, type SimContext } from "../src/components/sizer/model";

function battery(overrides: Partial<Battery> = {}): Battery {
  return {
    id: "skip",
    name: "Skip Sample",
    usable_capacity_kwh: 10,
    max_charge_rate_kw: 5,
    max_discharge_rate_kw: 5,
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

function peakedLoad(peakKw: number): number[] {
  const load = new Array<number>(HOURS_PER_YEAR).fill(40);
  load[100] = peakKw;
  return load;
}

function evalInput(quantity: number, pack: Battery = battery()): CandidateEvalInput {
  return {
    load_kwh: peakedLoad(120),
    rate: demandRate(),
    battery: pack,
    quantity,
    strategy: "demand_peak_shave",
    discount_rate: 0,
    rate_escalator: 0,
    analysis_years: 1,
    backup: {
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 10,
      start_soc: 1,
      include_solar: false,
    },
  };
}

function simOf(input: CandidateEvalInput): SimContext {
  return {
    load_kwh: [...input.load_kwh],
    solar_kwh: new Array<number>(HOURS_PER_YEAR).fill(0),
    rate: input.rate,
    strategy: input.strategy,
    soc_min: 0,
    soc_max: 1,
    backup: input.backup ?? {
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 10,
      start_soc: 1,
      include_solar: false,
    },
    discount_rate: input.discount_rate ?? 0,
    rate_escalator: input.rate_escalator ?? 0,
    analysis_years: input.analysis_years ?? 1,
  };
}

function row(pack: Battery, quantity: number, annualSavings: number): CandidateMetrics {
  return {
    battery: pack,
    quantity,
    strategy: "demand_peak_shave",
    installed_cost_usd: installedCost(pack, quantity),
    annual_savings_usd: annualSavings,
    simple_payback_years: 10,
    npv_usd: annualSavings,
    irr: 0.1,
    peak_reduction_kw: quantity,
    monthly_peak_reduction_kw: new Array<number>(12).fill(0),
    self_consumption_pct: null,
    equivalent_cycles: 1,
    backup_hours: 1,
    warnings: [],
  };
}

describe("quantity override", () => {
  it("offers 3 and 6 when the sampled sweep skipped them, and those quantities simulate", () => {
    const pack = battery();
    const peakKw = 120;
    const swept = sweepBatteries({
      load_kwh: peakedLoad(peakKw),
      rate: demandRate(),
      batteries: [pack],
      max_quantity: 24,
      strategy: "demand_peak_shave",
      analysis_years: 1,
      discount_rate: 0,
      rate_escalator: 0,
    });
    const sampled = swept.map((entry) => entry.quantity);
    expect(sampled).not.toContain(3);
    expect(sampled).not.toContain(6);
    expect(sampled.length).toBeGreaterThan(1);

    const choices = quantityChoicesForBattery(pack, peakKw);
    expect(choices[0]).toBe(1);
    expect(choices.at(-1)).toBeGreaterThanOrEqual(OVERRIDE_QUANTITY_FLOOR);
    expect(choices.at(-1)).toBeLessThanOrEqual(OVERRIDE_QUANTITY_CAP);
    expect(choices).toEqual(Array.from({ length: choices.length }, (_, index) => index + 1));
    expect(choices).toContain(3);
    expect(choices).toContain(6);

    const three = evaluateCandidate(evalInput(3));
    const six = evaluateCandidate(evalInput(6));
    expect(three.quantity).toBe(3);
    expect(six.quantity).toBe(6);
    expect(three.installed_cost_usd).toBe(installedCost(pack, 3));
    expect(six.installed_cost_usd).toBe(installedCost(pack, 6));
    expect(six.installed_cost_usd).toBeGreaterThan(three.installed_cost_usd);
    expect(Number.isFinite(three.annual_savings_usd)).toBe(true);
    expect(Number.isFinite(six.annual_savings_usd)).toBe(true);
    expect(three.backup_hours).not.toBeNull();
    expect(six.peak_reduction_kw).toBeGreaterThan(0);

    const shown = comparisonRows(swept, [three], MAX_ANNUAL_SAVINGS, {});
    expect(shown.filter((entry) => entry.quantity === 3)).toHaveLength(1);
    expect(shown.some((entry) => entry.quantity === 6)).toBe(false);
    const withSix = comparisonRows(shown, [six], MAX_ANNUAL_SAVINGS, {});
    expect(withSix.filter((entry) => entry.quantity === 3)).toHaveLength(1);
    expect(withSix.filter((entry) => entry.quantity === 6)).toHaveLength(1);
  });

  it("caches a simulated quantity and still computes the other skipped count", () => {
    const cache = new Map<string, CandidateMetrics>();
    let calls = 0;
    const three = cachedCandidate(cache, "skip", 3, () => {
      calls += 1;
      return evaluateCandidate(evalInput(3));
    });
    const again = cachedCandidate(cache, "skip", 3, () => {
      calls += 1;
      return evaluateCandidate(evalInput(3));
    });
    const six = cachedCandidate(cache, "skip", 6, () => {
      calls += 1;
      return evaluateCandidate(evalInput(6));
    });
    expect(again).toBe(three);
    expect(calls).toBe(2);
    expect(three.quantity).toBe(3);
    expect(six.quantity).toBe(6);
    expect(six.installed_cost_usd).toBeGreaterThan(three.installed_cost_usd);
  });

  it("scales the menu to 1.5× site peak, with a floor of 10 and a cap of 100", () => {
    expect(overrideQuantityMax(battery(), 0)).toBe(OVERRIDE_QUANTITY_FLOOR);
    const block = battery({
      id: "block",
      usable_capacity_kwh: 3854,
      max_charge_rate_kw: 1927,
      max_discharge_rate_kw: 1927,
    });
    expect(overrideQuantityMax(block, 120)).toBe(OVERRIDE_QUANTITY_FLOOR);
    expect(quantityChoicesForBattery(block, 120)).toEqual(
      Array.from({ length: OVERRIDE_QUANTITY_FLOOR }, (_, index) => index + 1),
    );
    const tiny = battery({ id: "tiny", usable_capacity_kwh: 1, max_charge_rate_kw: 1, max_discharge_rate_kw: 1 });
    expect(overrideQuantityMax(tiny, 200)).toBe(OVERRIDE_QUANTITY_CAP);
    const extended = quantityChoicesForBattery(block, 120, [3, 6, 40]);
    expect(extended).toContain(3);
    expect(extended).toContain(6);
    expect(extended.at(-1)).toBe(40);
  });

  it("fills a short contiguous span for a top battery, including 3 and 6, and skips a wide one", () => {
    const pack = battery();
    const holes = [1, 2, 4, 5, 7].map((quantity) => row(pack, quantity, 100 - quantity));
    expect(planContiguousQuantities(holes).map((plan) => plan.quantities)).toEqual([[3, 6]]);

    const wide = battery({ id: "wide", name: "Wide" });
    const rankedWideFirst = [row(wide, 1, 500), row(wide, 24, 400), ...holes];
    const plans = planContiguousQuantities(rankedWideFirst);
    expect(plans.map((plan) => plan.battery.id)).toEqual(["skip"]);
    expect(plans[0]?.quantities).toEqual([3, 6]);
    expect(planContiguousQuantities([row(wide, 1, 1), row(wide, 1 + CONTIGUOUS_EXTRA_BUDGET + 2, 1)])).toEqual([]);

    const input = evalInput(1);
    const swept = [1, 2, 4, 5, 7].map((quantity) => evaluateCandidate({ ...input, quantity }));
    const ranked = rankSweep({ ok: true, swept, sim: simOf(input) }, "max_annual_savings", "0", "1");
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.swept.map((entry) => entry.quantity).sort((a, b) => a - b)).toEqual([1, 2, 4, 5, 7]);
    const quantities = ranked.ranked.map((entry) => entry.quantity).sort((a, b) => a - b);
    expect(quantities).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const three = ranked.ranked.find((entry) => entry.quantity === 3);
    const six = ranked.ranked.find((entry) => entry.quantity === 6);
    expect(three?.installed_cost_usd).toBe(installedCost(pack, 3));
    expect(six?.installed_cost_usd).toBe(installedCost(pack, 6));
    expect(Number.isFinite(three?.annual_savings_usd)).toBe(true);
    expect(Number.isFinite(six?.annual_savings_usd)).toBe(true);
  });
});
