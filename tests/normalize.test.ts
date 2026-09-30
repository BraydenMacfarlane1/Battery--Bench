import { describe, expect, it } from "vitest";
import { HOURS_PER_YEAR, hoursBetween } from "../src/dispatch/calendar";
import { assertRateModel } from "../src/dispatch/bill";
import {
  normalizeBatteryCatalog,
  normalizeProjectExport,
  normalizeProjectList,
  normalizeRatePair,
} from "../src/sun-daddy/normalize";
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
