import { describe, expect, it } from "vitest";
import { assertRateModel, hourlyPrices } from "../src/dispatch/bill";
import { HOURS_PER_YEAR, buildCalendar, hoursBetween, monthSpans } from "../src/dispatch/calendar";
import { simulateDispatch } from "../src/dispatch/simulate";
import type { Battery } from "../src/dispatch/types";
import { formatUtilityLabel } from "../src/components/sizer/format";
import {
  normalizeBatteryCatalog,
  normalizeProjectExport,
  normalizeProjectList,
  normalizeRatePair,
} from "../src/sun-daddy/normalize";
import { TARIFF_INCOMPLETE } from "../src/sun-daddy/types";
import { flatLgsRate } from "./flat-lgs-fixture";

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

  it("keeps load.hourly_source when the hourly series is complete", () => {
    const hourly = new Array<number>(HOURS_PER_YEAR).fill(1);
    const measured = normalizeProjectExport({
      load: { hourly_kwh: hourly, hourly_source: "measured" },
    });
    expect(measured.load_kwh).toHaveLength(HOURS_PER_YEAR);
    expect(measured.load_hourly_source).toBe("measured");

    const estimated = normalizeProjectExport({
      load: { hourly_kwh: hourly, hourly_source: "estimated_from_bills" },
    });
    expect(estimated.load_hourly_source).toBe("estimated");

    const monthlyOnly = normalizeProjectExport({
      load: { monthly_kwh: new Array<number>(12).fill(10), hourly_source: "estimated" },
    });
    expect(monthlyOnly.load_kwh).toBeNull();
    expect(monthlyOnly.load_hourly_source).toBeNull();
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

/** Live export ids are JSON numbers. Names and addresses here are synthetic. */
function rateWithNumericIds(id: number): Record<string, unknown> {
  const rate = sceBaseRate();
  rate.id = id;
  const seasons = [
    { id: 1, start_month: 6, end_month: 9 },
    { id: 2, start_month: 10, end_month: 5 },
  ];
  rate.seasons = seasons;
  const model = rate.model_json as { seasons: unknown; components: Record<string, unknown>[] };
  model.seasons = seasons.map((season) => ({ ...season }));
  model.components[0].season_ids = [1, 2];
  model.components[1].season_ids = [1];
  model.components[2].season_ids = [2];
  return rate;
}

function flatHours(value: number): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(value);
}

function syntheticCabinet(id: number | string): Record<string, unknown> {
  return {
    id,
    name: "Synthetic cabinet",
    manufacturer: "Synthetic Mfr",
    model: "SYN-100",
    usable_capacity_kwh: 100,
    max_charge_rate_kw: 50,
    max_discharge_rate_kw: 50,
    cost_per_unit: 40000,
    cost_per_additional_unit: 36000,
    notes: "Synthetic catalog row",
    round_trip_efficiency: null,
  };
}

function realisticExport(): Record<string, unknown> {
  const load = flatHours(1.25);
  const solar = flatHours(0.4);
  return {
    schema_version: 1,
    project: {
      economics: {
        id: 93,
        name: "Solar + Battery - Carport",
        label: "Synthetic carport",
        customer_name: "Synthetic Customer",
        project_type: "solar_battery",
        system_size_kw: 120.5,
        system_cost: 180000,
        battery_equipment_cost: 64000,
        analysis_period: 25,
        discount_rate: 6.0,
        rate_escalator: 2.5,
        federal_tax_rate: 21,
        state_tax_rate: 4.5,
        use_macrs: true,
        batteries: [
          { battery_id: 7, quantity: 2, charge_source: "solar" },
          { battery_id: "rack-a", quantity: 1, charge_source: "grid" },
        ],
        incentives: [],
      },
    },
    load: {
      source: "interval",
      hourly_kwh: load,
      monthly_kwh: new Array<number>(12).fill(900),
      profiles: [
        {
          id: 4,
          label: "Main meter",
          pre_rate_id: 15,
          pre_rate: rateWithNumericIds(15),
          nem_rate: { id: 16, is_nem_schedule: true, export_credit_kwh: 0 },
          peaks: [{ month: 8, peak_kw: 90 }],
          bill_segments: [{ month: 8, peak_kw: 90, total_kwh: 4000 }],
        },
      ],
    },
    solar: {
      system_size_kw: 120.5,
      series: [
        { solar_type: "carport", label: "Carport", hourly_kwh: solar, annual_kwh: 3504 },
        { solar_type: "roof", label: "Annual only", annual_kwh: 500 },
      ],
    },
    rates: {
      pre: {
        rate: rateWithNumericIds(15),
        nem_rate: { id: 16, is_nem_schedule: true, export_credit_kwh: 0 },
      },
      post: [
        {
          rate: { id: 21, name: "Synthetic post", fixed_monthly_charge: 12 },
          nem_rate: { id: 22, export_credit_kwh: 0.02 },
          generation_rate: { id: 23, name: "Synthetic generation", fixed_monthly_charge: 0 },
          generation_nem_rate: { id: 24, export_credit_kwh: 0.01 },
          billing_service_type: "bundled",
        },
      ],
    },
    batteries: [syntheticCabinet(7), { ...syntheticCabinet("rack-a"), name: "Synthetic rack" }],
  };
}

describe("numeric export ids", () => {
  it("keeps numeric project ids from the live list shape", () => {
    const listed = normalizeProjectList({
      projects: [
        {
          id: 93,
          name: "Solar + Battery - Carport",
          label: "Synthetic carport",
          project_type: "solar_battery",
          status: "complete",
          customer_id: 80,
          customer_name: "Synthetic Customer",
          site_address: "100 Synthetic Way",
          utility: "Synthetic Power",
          pre_rate_id: null,
          updated_at: "2026-03-02 12:00:00",
        },
        {
          id: 94,
          name: "Solar only - Roof",
          project_type: "solar",
          status: "draft",
          customer_id: 81,
          pre_rate_id: 3,
          updated_at: "2026-03-02 12:00:00",
        },
      ],
    });
    expect(listed.warnings).toEqual([]);
    expect(listed.projects).toEqual([
      {
        id: "93",
        name: "Solar + Battery - Carport",
        customer_id: "80",
        customer_name: "Synthetic Customer",
        label: "Synthetic carport",
        project_type: "solar_battery",
        status: "complete",
        site_address: "100 Synthetic Way",
        utility: "Synthetic Power",
        updated_at: "2026-03-02 12:00:00",
      },
      {
        id: "94",
        name: "Solar only - Roof",
        customer_id: "81",
        project_type: "solar",
        status: "draft",
        updated_at: "2026-03-02 12:00:00",
      },
    ]);
  });

  it("does not drop a mixed-type project list without a warning", () => {
    const mixed = normalizeProjectList([
      { id: 93, name: "Solar + Battery - Carport" },
      { id: "proj_string", name: "String id warehouse" },
      { id: { nested: true }, name: "Object id" },
      { name: "Missing id" },
      { id: "", name: "Blank id" },
      null,
      "not-an-object",
    ]);
    expect(mixed.projects.map((project) => project.id)).toEqual(["93", "proj_string"]);
    expect(mixed.projects.length).toBeGreaterThan(0);
    expect(mixed.warnings.length).toBeGreaterThan(0);
    expect(mixed.warnings.join(" ")).toMatch(/not a string or number/);
    expect(mixed.warnings.join(" ")).toMatch(/had no id/);
    expect(mixed.warnings.join(" ")).toMatch(/not an object/);

    const onlyBad = normalizeProjectList([{ id: { nested: true } }, { id: false }, null]);
    expect(onlyBad.projects).toEqual([]);
    expect(onlyBad.warnings.length).toBeGreaterThan(0);
    expect(onlyBad.warnings.join(" ")).toMatch(/skipped/);
    expect(onlyBad.warnings.join(" ")).toMatch(/string or number|not an object/);
  });

  it("normalizes a schema_version 1 export whose ids are numbers", () => {
    const study = normalizeProjectExport(realisticExport());
    expect(study.schema_version).toBe(1);
    expect(study.project_id).toBe("93");
    expect(study.project_name).toBe("Solar + Battery - Carport");
    expect(study.project_name).not.toBe("Synthetic Customer");
    expect(study.load_kwh).toHaveLength(HOURS_PER_YEAR);
    expect(study.load_kwh?.[0]).toBe(1.25);
    expect(study.monthly_kwh?.[0]).toBe(900);
    expect(study.billed_peak_kw[7]).toBe(90);
    expect(study.solar_kwh?.[0]).toBe(0.4);
    expect(study.solar_series[1].hourly_kwh).toBeNull();
    expect(study.economics.discount_rate).toBeCloseTo(0.06);
    expect(study.economics.rate_escalator).toBeCloseTo(0.025);
    expect(study.economics.federal_tax_rate).toBeCloseTo(0.21);
    expect(study.economics.state_tax_rate).toBeCloseTo(0.045);
    expect(study.economics.analysis_period).toBe(25);
    expect(study.economics.system_size_kw).toBe(120.5);
    expect(study.batteries.map((battery) => battery.id)).toEqual(["7", "rack-a"]);
    expect(study.selected_batteries).toEqual([
      { battery_id: "7", quantity: 2 },
      { battery_id: "rack-a", quantity: 1 },
    ]);
    expect(study.batteries[0].round_trip_efficiency).toBe(0.9);
    expect(study.batteries[0].cost_per_additional_unit).toBe(36000);
    const pre = study.pre_rate.rate;
    if (!pre) throw new Error("expected a pre rate");
    assertRateModel(pre);
    expect(pre.id).toBe("15");
    expect(pre.seasons.map((season) => season.id)).toEqual(["1", "2"]);
    expect(pre.demand_components.find((component) => component.name === "Facilities")?.season_ids).toEqual(["1", "2"]);
    expect(pre.demand_components.find((component) => component.name === "Summer on-peak generation")?.season_ids).toEqual(["1"]);
    expect(pre.fixed_monthly_charge).toBeCloseTo(268.43);
    expect(pre.export_credit_kwh).toBe(0);
    expect(study.post_rates[0].rate?.id).toBe("21");
    expect(study.post_rates[0].rate?.export_credit_kwh).toBe(0.02);
    expect(study.warnings.join(" ")).not.toMatch(/had no id|battery_id|not a string or number/);
    expect(study.pre_rate.warnings.some((warning) => warning === TARIFF_INCOMPLETE)).toBe(false);

    const stringBatteryId = normalizeProjectExport({
      schema_version: 1,
      project: {
        id: 94,
        name: "Numeric project id",
        economics: { batteries: [{ battery_id: "7", quantity: 1, charge_source: "solar" }] },
      },
      batteries: [syntheticCabinet(7)],
    });
    expect(stringBatteryId.project_id).toBe("94");
    expect(stringBatteryId.batteries[0].id).toBe("7");
    expect(stringBatteryId.warnings.join(" ")).not.toMatch(/Project battery|battery selection/);
  });

  it("stringifies numeric battery catalog ids and still accepts string ids", () => {
    const catalog = normalizeBatteryCatalog({
      batteries: [syntheticCabinet(7), syntheticCabinet("rack-a")],
    });
    expect(catalog.warnings).toEqual([]);
    expect(catalog.batteries.map((battery) => battery.id)).toEqual(["7", "rack-a"]);
  });

  it("accepts a numeric rate id and a string rate id", () => {
    const numeric = normalizeRatePair(
      { id: 15, name: "Numeric rate", fixed_monthly_charge: 4 },
      { id: 16, export_credit_kwh: 0.01 },
      "Pre",
    );
    const text = normalizeRatePair(
      { id: "rate_string", name: "String rate", fixed_monthly_charge: 4 },
      { export_credit_kwh: 0 },
      "Pre",
    );
    expect(numeric.rate?.id).toBe("15");
    expect(text.rate?.id).toBe("rate_string");
  });
});

const FLAT_DEMAND_PER_KW = 4.6 + 5.48;
const FLAT_ENERGY_PER_KWH = 0.06746 + 0.00722 + 0.0002 + -0.00052 + 0.00165;

function peakyLoad(): number[] {
  const load = new Array<number>(HOURS_PER_YEAR).fill(30);
  for (const span of monthSpans()) {
    load[span.start + 18] = 100;
    load[span.start + 19] = 100;
  }
  return load;
}

describe("flat tariff components", () => {
  it("prices a year-round flat rate and does not warn about missing masks or a zero tax", () => {
    const normalized = normalizeRatePair(flatLgsRate(), null, "Pre");
    const rate = normalized.rate;
    if (!rate) throw new Error("expected a rate");
    assertRateModel(rate);
    expect(normalized.warnings).toEqual([]);
    expect(normalized.utility).toBe("NVenergy");
    expect(normalized.state).toBe("NV");
    expect(rate.name).toBe("LGS-1");
    expect(rate.fixed_monthly_charge).toBeCloseTo(15.8);
    expect(rate.min_bill_usd).toBeCloseTo(15.8);
    expect(rate.tax_rate).toBeUndefined();
    expect(rate.demand_components.map((component) => component.demand_rate_kw)).toEqual([4.6, 5.48]);
    expect(rate.demand_components.every((component) => component.weekday_hours.every(Boolean))).toBe(true);
    expect(rate.demand_components.every((component) => component.weekend_hours.every(Boolean))).toBe(true);
    expect(rate.energy_periods.map((period) => period.name)).toEqual(["Usage", "DEAA", "TRED", "REPR", "EE"]);
    expect(rate.energy_periods.reduce((sum, period) => sum + period.energy_rate_kwh, 0)).toBeCloseTo(FLAT_ENERGY_PER_KWH);
    const prices = hourlyPrices(rate, buildCalendar(1));
    expect(prices.unpricedHours).toBe(0);
    expect(prices.importRate[0]).toBeCloseTo(FLAT_ENERGY_PER_KWH);
    expect(prices.importRate[100]).toBeCloseTo(FLAT_ENERGY_PER_KWH);
  });

  it("reduces the flat demand charge by the stacked $/kW when a battery shaves the peak", () => {
    const normalized = normalizeRatePair(flatLgsRate(), null, "Pre");
    const rate = normalized.rate;
    if (!rate) throw new Error("expected a rate");
    const battery: Battery = {
      id: "synthetic-pack",
      name: "Synthetic pack",
      usable_capacity_kwh: 200,
      max_charge_rate_kw: 80,
      max_discharge_rate_kw: 80,
      cost_per_unit: 1000,
      round_trip_efficiency: 1,
      degradation_per_year: 0,
    };
    const result = simulateDispatch({
      load_kwh: peakyLoad(),
      rate,
      battery,
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    expect(result.with_battery.total_usd).toBeLessThan(result.baseline.total_usd);
    let shaved = false;
    for (let month = 0; month < 12; month += 1) {
      const reduced = result.monthly_peak_kw.baseline[month] - result.monthly_peak_kw.with_battery[month];
      const demandReduced = result.baseline.months[month].demand_usd - result.with_battery.months[month].demand_usd;
      expect(demandReduced).toBeCloseTo(reduced * FLAT_DEMAND_PER_KW);
      if (reduced > 1) shaved = true;
    }
    expect(shaved).toBe(true);
  });

  it("keeps utility and state from the load profile when the priced rate omits them", () => {
    const study = normalizeProjectExport({
      schema_version: 1,
      project: { id: "synthetic-lgs", name: "Synthetic warehouse" },
      rates: { pre: { rate: flatLgsRate({ utility: null, state: null, name: null }) } },
      load: {
        hourly_kwh: new Array<number>(HOURS_PER_YEAR).fill(1),
        profiles: [{ pre_rate: flatLgsRate() }],
      },
    });
    expect(study.pre_rate.warnings).toEqual([]);
    expect(study.pre_rate.utility).toBe("NVenergy");
    expect(study.pre_rate.state).toBe("NV");
    expect(study.pre_rate.rate?.name).toBe("LGS-1");
    expect(study.warnings.join(" ")).not.toContain("mask");
  });

  it("still skips a non-flat component that has no hour mask, and names other dropped pieces", () => {
    const masked = normalizeRatePair(
      {
        name: "Partial synthetic",
        model_json: {
          components: [
            { kind: "energy", label: "Usage", value_type: "flat", target: "import", rate: 0.1 },
            { kind: "demand", label: "On-peak", value_type: "tou", rate: 9 },
            { kind: "demand", name: "Mystery", rate: 3 },
            { kind: "energy", label: "Block", value_type: "tiered", rate: 0.4, tiers: [{ up_to: 100, rate: 0.4 }] },
            { kind: "energy", label: "Odd", value_type: "ratchet", rate: 1 },
            { kind: "percent", label: "City tax", rate: 2 },
            { kind: "energy", label: "Net", value_type: "flat", target: "net", rate: 0.2 },
          ],
        },
      },
      null,
      "Partial",
    );
    expect(masked.warnings[0]).toBe(TARIFF_INCOMPLETE);
    expect(masked.rate?.energy_periods.map((period) => period.name)).toEqual(["Usage"]);
    expect(masked.rate?.demand_components).toEqual([]);
    const text = masked.warnings.join(" ");
    expect(text).toContain("On-peak had no 24-hour weekday/weekend mask and was skipped.");
    expect(text).toContain("Mystery had no 24-hour weekday/weekend mask and was skipped.");
    expect(text).toContain("Block is tiered and was not priced.");
    expect(text).toContain("Odd has unsupported value_type ratchet and was skipped.");
    expect(text).toContain("City tax is a percent component and was not priced.");
    expect(text).toContain("Net has target net and was skipped.");
  });

  it("prices a seasonal value on every hour of its season and skips a seasonal component with no season", () => {
    const normalized = normalizeRatePair(
      {
        name: "Seasonal synthetic",
        model_json: {
          seasons: [{ id: "summer", start_month: 6, end_month: 9 }],
          components: [
            { kind: "energy", label: "Summer", value_type: "seasonal", rate: 0.2, season_ids: ["summer"] },
            { kind: "demand", label: "Summer demand", value_type: "seasonal", rate: 6, season_ids: ["summer"] },
            { kind: "energy", label: "Nowhere", value_type: "seasonal", rate: 0.3 },
            { kind: "import_kwh", label: "Import adder", value_type: "flat", rate: 0.01 },
            { kind: "energy", label: "Sell", value_type: "flat", target: "export", rate: 0.03 },
          ],
        },
      },
      null,
      "Seasonal",
    );
    expect(normalized.warnings[0]).toBe(TARIFF_INCOMPLETE);
    expect(normalized.warnings.join(" ")).toContain("Nowhere is seasonal but has no season or month and was skipped.");
    const summer = normalized.rate?.energy_periods.find((period) => period.name === "Summer");
    const adder = normalized.rate?.energy_periods.find((period) => period.name === "Import adder");
    const sell = normalized.rate?.energy_periods.find((period) => period.name === "Sell");
    expect(summer).toMatchObject({ energy_rate_kwh: 0.2, season_ids: ["summer"] });
    expect(summer?.weekday_hours.every(Boolean)).toBe(true);
    expect(normalized.rate?.demand_components[0]).toMatchObject({
      name: "Summer demand",
      demand_rate_kw: 6,
      season_ids: ["summer"],
    });
    expect(adder?.energy_rate_kwh).toBeCloseTo(0.01);
    expect(sell).toMatchObject({ energy_rate_kwh: 0, export_rate_kwh: 0.03 });
  });

  it("applies a fraction tax, a percent tax, and ignores zero without a warning", () => {
    const priced = (tax: number) =>
      normalizeRatePair(
        {
          name: "Tax synthetic",
          model_json: {
            tax_rate: tax,
            components: [{ kind: "energy", label: "Usage", value_type: "flat", rate: 0.1 }],
          },
        },
        null,
        "Tax",
      );

    expect(priced(0).warnings).toEqual([]);
    expect(priced(0).rate?.tax_rate).toBeUndefined();
    expect(priced(0.0825).warnings).toEqual([]);
    expect(priced(0.0825).rate?.tax_rate).toBeCloseTo(0.0825);
    expect(priced(8.25).warnings).toEqual([]);
    expect(priced(8.25).rate?.tax_rate).toBeCloseTo(0.0825);

    const ambiguous = priced(1);
    expect(ambiguous.warnings[0]).toBe(TARIFF_INCOMPLETE);
    expect(ambiguous.warnings.join(" ")).toContain("not clear if it is a percent or a fraction");
    expect(ambiguous.rate?.tax_rate).toBeUndefined();

    const columnPercent = normalizeRatePair(
      {
        name: "Column tax",
        tax_rate: 8.25,
        flat_periods: [
          {
            period_name: "All",
            energy_rate_kwh: 0.1,
          },
        ],
      },
      null,
      "Column",
    );
    expect(columnPercent.warnings).toEqual([]);
    expect(columnPercent.rate?.tax_rate).toBeCloseTo(0.0825);

    const monthly = normalizeRatePair(
      {
        name: "Monthly netting",
        model_json: {
          netting: "monthly",
          credit_rollover: "indefinite",
          export_credit_scope: "energy_only",
          true_up_month: 12,
          components: [{ kind: "fixed", label: "Customer", rate: 4 }],
        },
      },
      null,
      "Monthly",
    );
    expect(monthly.warnings[0]).toBe(TARIFF_INCOMPLETE);
    const notes = monthly.warnings.join(" ");
    expect(notes).toContain("netting is monthly");
    expect(notes).toContain("indefinite");
    expect(notes).toContain("energy_only");
    expect(notes).toContain("true-up");
    expect(monthly.rate?.fixed_monthly_charge).toBe(4);
  });
});

describe("utility display names", () => {
  it("tidies obvious compact utility names and leaves unknown names as written", () => {
    expect(formatUtilityLabel("NVenergy", "NV")).toBe("NV Energy (NV)");
    expect(formatUtilityLabel("NV Energy", "nv")).toBe("NV Energy (NV)");
    expect(formatUtilityLabel("NVenergy", null)).toBe("NV Energy");
    expect(formatUtilityLabel("City Power", "UT")).toBe("City Power (UT)");
    expect(formatUtilityLabel("SCE", "CA")).toBe("SCE (CA)");
    expect(formatUtilityLabel(null, "NV")).toBeNull();
  });
});
