import { describe, expect, it } from "vitest";
import { HOURS_PER_YEAR, hoursBetween } from "../src/dispatch/calendar";
import { assertRateModel } from "../src/dispatch/bill";
import { normalizeProjectExport, normalizeRatePair } from "../src/sun-daddy/normalize";
import { TARIFF_INCOMPLETE } from "../src/sun-daddy/types";

const onPeak = hoursBetween(16, 21);
const offPeak = onPeak.map((hour) => !hour);

/** Synthetic SCE TOU-GS-2-E shape. Demand and customer-charge numbers are the ones given for this fixture. */
function sceBaseRate(): Record<string, unknown> {
  return {
    name: "SCE TOU-GS-2-E",
    utility: "SCE",
    state: "CA",
    fixed_monthly_charge: 268.43,
    facilities_charge_kw: 15.83,
    tou_periods: [],
    export_credit_kwh: 9.99,
    seasons: [
      { id: "1", start_month: 6, end_month: 9 },
      { id: "2", start_month: 10, end_month: 5 },
    ],
    model_json: {
      seasons: [
        { id: "1", start_month: 6, end_month: 9 },
        { id: "2", start_month: 10, end_month: 5 },
      ],
      components: [
        {
          kind: "demand",
          name: "Facilities",
          rate: 15.83,
          is_facilities: true,
          season_ids: ["1", "2"],
        },
        {
          kind: "demand",
          name: "Summer on-peak generation",
          rate: 5.65,
          is_facilities: false,
          season_ids: ["1"],
          weekday_hours: onPeak,
          weekend_hours: offPeak.map(() => false),
        },
        {
          kind: "demand",
          name: "Winter mid-peak generation",
          rate: 1.93,
          is_facilities: false,
          season_ids: ["2"],
          weekday_hours: onPeak,
          weekend_hours: onPeak.map(() => false),
        },
        { kind: "fixed", name: "Customer charge", rate: 268.43 },
      ],
    },
  };
}

describe("tariff normalizer", () => {
  it("prices the synthetic SCE demand shape without doubling facilities or the customer charge", () => {
    const normalized = normalizeRatePair(sceBaseRate(), { is_nem_schedule: true, export_credit_kwh: 0 }, "Pre");
    const rate = normalized.rate;
    if (!rate) throw new Error("expected a rate");
    assertRateModel(rate);
    expect(normalized.warnings.some((warning) => warning === TARIFF_INCOMPLETE)).toBe(false);
    expect(rate.fixed_monthly_charge).toBeCloseTo(268.43);
    expect(rate.export_credit_kwh).toBe(0);
    expect(rate.demand_components).toHaveLength(3);
    const facilities = rate.demand_components.find((component) => component.name === "Facilities");
    const summer = rate.demand_components.find((component) => component.name === "Summer on-peak generation");
    const winter = rate.demand_components.find((component) => component.name === "Winter mid-peak generation");
    expect(facilities).toMatchObject({ demand_rate_kw: 15.83, is_facilities: true, season_ids: ["1", "2"] });
    expect(summer).toMatchObject({ demand_rate_kw: 5.65, is_facilities: false, season_ids: ["1"] });
    expect(winter).toMatchObject({ demand_rate_kw: 1.93, is_facilities: false, season_ids: ["2"] });
    expect(summer?.weekday_hours.slice(16, 21)).toEqual([true, true, true, true, true]);
    expect(summer?.weekday_hours[15]).toBe(false);
    expect(summer?.weekday_hours[21]).toBe(false);
    expect(summer?.weekend_hours.some(Boolean)).toBe(false);
  });

  it("warns instead of guessing when the tariff has tiers or percent adders", () => {
    const tiered = normalizeRatePair(
      {
        name: "Tiered synthetic",
        tiered_periods: [{ tier: 1, energy_rate_kwh: 0.5 }],
        flat_periods: [],
        tou_periods: [],
      },
      null,
      "Tiered",
    );
    expect(tiered.warnings[0]).toBe(TARIFF_INCOMPLETE);
    expect(tiered.warnings.join(" ")).toContain("Tiered energy is not modeled");
    expect(tiered.rate?.energy_periods).toEqual([]);

    const percent = normalizeRatePair(
      {
        name: "Percent synthetic",
        model_json: {
          components: [{ kind: "percent", name: "City tax", rate: 12 }],
        },
      },
      null,
      "Percent",
    );
    expect(percent.warnings).toContain(TARIFF_INCOMPLETE);
    expect(percent.warnings.join(" ")).toContain("percent");
    expect(percent.rate?.energy_periods).toEqual([]);
    expect(percent.rate?.fixed_monthly_charge).toBe(0);
  });

  it("does not stack delivery on top of TOU energy when both are present", () => {
    const normalized = normalizeRatePair(
      {
        name: "Overlap synthetic",
        delivery_rate_kwh: 0.1,
        tou_periods: [
          {
            period_name: "All",
            weekday_hours: hoursBetween(0, 24),
            weekend_hours: hoursBetween(0, 24),
            energy_rate_kwh: 0.2,
          },
        ],
      },
      null,
      "Overlap",
    );
    expect(normalized.warnings).toContain(TARIFF_INCOMPLETE);
    expect(normalized.rate?.energy_periods).toHaveLength(1);
    expect(normalized.rate?.energy_periods[0].energy_rate_kwh).toBe(0.2);
  });
});

describe("project export", () => {
  it("normalizes economics, batteries, load gaps, solar, and the first-meter fallback", () => {
    const hourly = new Array<number | null>(HOURS_PER_YEAR).fill(2);
    hourly[10] = null;
    const solarA = new Array<number>(HOURS_PER_YEAR).fill(0);
    const solarB = new Array<number>(HOURS_PER_YEAR).fill(0);
    solarA[12] = 4;
    solarB[12] = 1;
    const study = normalizeProjectExport({
      schema_version: 1,
      project: {
        id: "proj_synthetic",
        name: "Synthetic warehouse",
        economics: {
          discount_rate: 6,
          rate_escalator: 2.5,
          federal_tax_rate: 21,
          state_tax_rate: 0,
          analysis_period: 20,
          system_size_kw: 80,
        },
      },
      load: {
        hourly_kwh: hourly,
        monthly_kwh: new Array<number>(12).fill(1000),
        profiles: [
          {
            peaks: [{ month: 7, peak_kw: 40 }, { month: 7, peak_kw: 42 }],
            pre_rate: sceBaseRate(),
            nem_rate: { export_credit_kwh: 0 },
          },
          { peaks: [{ month: 1, peak_kw: 99 }] },
        ],
      },
      solar: {
        series: [
          { solar_type: "roof", label: "Roof", hourly_kwh: solarA, annual_kwh: 4 },
          { solar_type: "carport", label: "Carport", hourly_kwh: solarB, annual_kwh: 1 },
          { solar_type: "ground", label: "Annual only", annual_kwh: 500 },
        ],
      },
      batteries: [
        {
          id: "b1",
          name: "Cabinet",
          manufacturer: "Example",
          model: "C-10",
          usable_capacity_kwh: 10,
          max_charge_rate_kw: 5,
          max_discharge_rate_kw: 5,
          cost_per_unit: 8000,
          cost_per_additional_unit: 6000,
          round_trip_efficiency: null,
        },
      ],
    });

    expect(study.project_id).toBe("proj_synthetic");
    expect(study.load_kwh).toBeNull();
    expect(study.warnings.join(" ")).toContain("missing 1 hours");
    expect(study.monthly_kwh?.[0]).toBe(1000);
    expect(study.billed_peak_kw[6]).toBe(42);
    expect(study.billed_peak_kw[0]).toBeNull();
    expect(study.warnings.join(" ")).toContain("first profile");
    expect(study.solar_kwh?.[12]).toBe(5);
    expect(study.solar_series[2].hourly_kwh).toBeNull();
    expect(study.economics.discount_rate).toBeCloseTo(0.06);
    expect(study.economics.rate_escalator).toBeCloseTo(0.025);
    expect(study.economics.federal_tax_rate).toBeCloseTo(0.21);
    expect(study.economics.state_tax_rate).toBe(0);
    expect(study.economics.analysis_period).toBe(20);
    expect(study.batteries[0].round_trip_efficiency).toBe(0.9);
    expect(study.pre_rate.rate?.fixed_monthly_charge).toBeCloseTo(268.43);
    expect(study.warnings.join(" ")).toContain("rates.pre was missing");
  });

  it("does not invent an hourly load from monthly kWh", () => {
    const study = normalizeProjectExport({
      schema_version: 1,
      project: { id: "m", name: "Monthly only" },
      load: { monthly_kwh: new Array<number>(12).fill(10) },
    });
    expect(study.load_kwh).toBeNull();
    expect(study.warnings.join(" ")).toContain("will not invent a shape");
  });
});
