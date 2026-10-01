import { describe, expect, it } from "vitest";
import { recommendBackup } from "../src/dispatch/backup";
import { hoursBetween } from "../src/dispatch/calendar";
import { degradationOf, netPresentValue, savingsCashFlows } from "../src/dispatch/economics";
import { incentiveOutcome } from "../src/dispatch/incentives";
import { backupPowerKw, chargePowerKw, dischargePowerKw, effectiveUsableKwh } from "../src/dispatch/specs";
import { simulateDispatch } from "../src/dispatch/simulate";
import type { Battery, RateModel } from "../src/dispatch/types";
import { billCheckView, overallConfidence } from "../src/sun-daddy/confidence";
import { normalizeBatteryCatalog, normalizeProjectExport, normalizeRatePair } from "../src/sun-daddy/normalize";
import type { BillCheck, ProjectFinance } from "../src/sun-daddy/types";

const HOURS = 8760;

function flatRate(): RateModel {
  const all = hoursBetween(0, 24);
  return {
    name: "Flat",
    seasons: [],
    energy_periods: [{ name: "All", weekday_hours: all, weekend_hours: all, energy_rate_kwh: 0.2 }],
    demand_components: [{ name: "Demand", weekday_hours: all, weekend_hours: all, demand_rate_kw: 10, is_facilities: true }],
    fixed_monthly_charge: 0,
    export_credit_kwh: 0,
  };
}

function peakedLoad(): number[] {
  const load = new Array<number>(HOURS).fill(20);
  load[100] = 80;
  load[101] = 80;
  return load;
}

function catalogRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pack",
    name: "Pack",
    usable_capacity_kwh: 100,
    max_charge_rate_kw: 50,
    max_discharge_rate_kw: 50,
    cost_per_unit: 10000,
    round_trip_efficiency: null,
    round_trip_efficiency_pct: null,
    degradation_pct_per_year: null,
    warranty_years: null,
    warranty_throughput_kwh: null,
    min_reserve_pct: null,
    backup_capable: null,
    continuous_kw: null,
    peak_kw: null,
    voltage: null,
    phases: null,
    coupling: null,
    dimensions_json: null,
    weight_kg: null,
    indoor_outdoor: null,
    max_units_per_system: null,
    datasheet_url: null,
    lead_time_weeks: null,
    cost_breakdown_json: null,
    ...extra,
  };
}

function handBattery(extra: Partial<Battery> = {}): Battery {
  return {
    id: "pack",
    name: "Pack",
    usable_capacity_kwh: 100,
    max_charge_rate_kw: 50,
    max_discharge_rate_kw: 50,
    cost_per_unit: 10000,
    round_trip_efficiency: 0.9,
    degradation_per_year: 0.02,
    ...extra,
  };
}

function emptyCheck(extra: Partial<BillCheck> = {}): BillCheck {
  return {
    status: null,
    blocked_reason: null,
    rate_id: null,
    rate_name: null,
    periods: null,
    by_month: null,
    annual: null,
    grade: null,
    other_info_usd: null,
    notes: null,
    warnings: null,
    ...extra,
  };
}

describe("null catalog specs", () => {
  it("keeps today's efficiency, power, reserve, and dispatch when every new spec is null", () => {
    const normalized = normalizeBatteryCatalog({ batteries: [catalogRow()] }).batteries[0];
    if (!normalized) throw new Error("expected a battery");
    expect(normalized.round_trip_efficiency).toBe(0.9);
    expect(normalized.efficiency_source).toBe("default");
    expect(normalized.round_trip_efficiency_pct).toBeNull();
    expect(normalized.degradation_per_year).toBeUndefined();
    expect(normalized.degradation_source).toBe("default");
    expect(degradationOf(normalized)).toBe(0.02);
    expect(effectiveUsableKwh(normalized)).toBe(100);
    expect(chargePowerKw(normalized)).toBe(50);
    expect(dischargePowerKw(normalized)).toBe(50);
    expect(backupPowerKw(normalized)).toBe(50);
    expect(normalized.warranty_years).toBeNull();
    expect(normalized.datasheet_url).toBeNull();
    expect(normalized.cost_breakdown_json).toBeNull();

    const withNulls = simulateDispatch({
      load_kwh: peakedLoad(),
      rate: flatRate(),
      battery: normalized,
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    const withoutFields = simulateDispatch({
      load_kwh: peakedLoad(),
      rate: flatRate(),
      battery: handBattery(),
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    expect(withNulls.annual_savings_usd).toBeCloseTo(withoutFields.annual_savings_usd);
  });

  it("uses a catalog percent, reserve, and power specs when they are set", () => {
    const battery = normalizeBatteryCatalog({
      batteries: [
        catalogRow({
          round_trip_efficiency: 90,
          round_trip_efficiency_pct: 80,
          degradation_pct_per_year: 5,
          min_reserve_pct: 10,
          continuous_kw: 20,
          peak_kw: 30,
        }),
      ],
    }).batteries[0];
    if (!battery) throw new Error("expected a battery");
    expect(battery.round_trip_efficiency).toBeCloseTo(0.8);
    expect(battery.efficiency_source).toBe("spec");
    expect(battery.degradation_per_year).toBeCloseTo(0.05);
    expect(effectiveUsableKwh(battery)).toBeCloseTo(90);
    expect(chargePowerKw(battery)).toBe(20);
    expect(dischargePowerKw(battery)).toBe(30);
    expect(backupPowerKw(battery)).toBe(20);

    const specRun = simulateDispatch({
      load_kwh: peakedLoad(),
      rate: flatRate(),
      battery,
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    const plainRun = simulateDispatch({
      load_kwh: peakedLoad(),
      rate: flatRate(),
      battery: handBattery(),
      quantity: 1,
      strategy: "demand_peak_shave",
      include_hourly: false,
    });
    expect(specRun.annual_savings_usd).not.toBeCloseTo(plainRun.annual_savings_usd);

    const specFlows = savingsCashFlows({
      installedCostUsd: 10000,
      annualSavingsUsd: 1000,
      degradationPerYear: degradationOf(battery),
      rateEscalator: 0,
      analysisYears: 2,
    });
    const defaultFlows = savingsCashFlows({
      installedCostUsd: 10000,
      annualSavingsUsd: 1000,
      degradationPerYear: 0.02,
      rateEscalator: 0,
      analysisYears: 2,
    });
    expect(specFlows[2]).toBeCloseTo(1000 * 0.95);
    expect(specFlows[2]).not.toBeCloseTo(defaultFlows[2]);
    expect(netPresentValue(0.06, specFlows)).not.toBeCloseTo(netPresentValue(0.06, defaultFlows));
  });

  it("reads a legacy percent above 1 and leaves a legacy fraction for the assumption field", () => {
    const legacyPercent = normalizeBatteryCatalog({ batteries: [catalogRow({ round_trip_efficiency: 90 })] }).batteries[0];
    const legacyFraction = normalizeBatteryCatalog({ batteries: [catalogRow({ round_trip_efficiency: 0.9 })] }).batteries[0];
    expect(legacyPercent?.round_trip_efficiency).toBeCloseTo(0.9);
    expect(legacyPercent?.efficiency_source).toBe("spec");
    expect(legacyFraction?.round_trip_efficiency).toBeCloseTo(0.9);
    expect(legacyFraction?.efficiency_source).toBe("default");
  });
});

describe("bill check and confidence", () => {
  it("shows no_actuals as unverified and not as a pass", () => {
    const hourly = new Array<number>(HOURS).fill(1);
    const study = normalizeProjectExport({
      schema_version: 1,
      project: { id: "p", name: "Warehouse" },
      load: {
        hourly_kwh: hourly,
        hourly_source: "measured",
        profiles: [
          {
            hourly_source: "measured",
            peaks_source: "billed",
            monthly_source: "bills",
            bill_check: {
              status: "no_actuals",
              blocked_reason: null,
              rate_id: null,
              rate_name: null,
              periods: null,
              by_month: null,
              annual: null,
              grade: null,
              other_info_usd: null,
              notes: null,
              warnings: null,
            },
          },
        ],
      },
      rates: {
        pre: {
          rate: { id: 1, name: "Flat", fixed_monthly_charge: 1, last_verified_at: null, source_url: null },
        },
      },
    });
    const view = billCheckView(study.load_profile.bill_check);
    expect(view.tone).toBe("neutral");
    expect(view.title).toBe("Not verified: no bills to check against");
    expect(view.savingsWarning).toBeNull();
    expect(study.load_profile.hourly_kind).toBe("measured");
    expect(study.load_profile.peaks_source).toBe("billed");
    expect(study.pre_rate.verification.last_verified_at).toBeNull();
    expect(
      overallConfidence({ hourlyKind: study.load_profile.hourly_kind, bill: study.load_profile.bill_check, rateVerified: false }),
    ).toBe("Medium");
  });

  it("labels grades A–D and lowers confidence for C, D, and a building-type shape", () => {
    const gradeA = emptyCheck({ status: "ok", grade: "A", annual: { actual: 1000, modeled: 1010, delta_pct: 1 } });
    const gradeB = emptyCheck({ status: "ok", grade: "B", annual: { actual: 1000, modeled: 1040, delta_pct: 4 } });
    const gradeC = emptyCheck({ status: "ok", grade: "C", annual: { actual: 1000, modeled: 1100, delta_pct: 10 } });
    const gradeD = emptyCheck({ status: "ok", grade: "D", annual: { actual: 1000, modeled: 1300, delta_pct: 30 } });

    expect(billCheckView(gradeA).tone).toBe("good");
    expect(billCheckView(gradeA).title).toBe("Bill check grade A");
    expect(billCheckView(gradeA).detail).toContain("1%");
    expect(billCheckView(gradeA).savingsWarning).toBeNull();
    expect(billCheckView(gradeB).tone).toBe("good");
    expect(billCheckView(gradeB).savingsWarning).toBeNull();
    expect(billCheckView(gradeC).tone).toBe("bad");
    expect(billCheckView(gradeC).savingsWarning).toMatch(/less reliable/);
    expect(billCheckView(gradeC).savingsWarning).toContain("C");
    expect(billCheckView(gradeD).savingsWarning).toContain("D");

    expect(overallConfidence({ hourlyKind: "measured", bill: gradeA, rateVerified: true })).toBe("Higher");
    expect(overallConfidence({ hourlyKind: "measured", bill: gradeA, rateVerified: false })).toBe("Medium");
    expect(overallConfidence({ hourlyKind: "measured", bill: gradeC, rateVerified: true })).toBe("Lower");
    expect(overallConfidence({ hourlyKind: "building_type_shape", bill: gradeA, rateVerified: true })).toBe("Lower");
    expect(overallConfidence({ hourlyKind: "synthesized_from_bills", bill: emptyCheck({ status: "no_actuals" }), rateVerified: false })).toBe(
      "Medium",
    );
  });
});

describe("empty NEM export credit", () => {
  it("names a data-gap NEM rate and a monthly NEM shell, and treats exports as $0", () => {
    const gap = normalizeRatePair(
      { id: 10, name: "GS", fixed_monthly_charge: 5 },
      { id: 36, name: "NV Energy NMR-B", is_nem_schedule: true, nem_type: "nem", export_credit_enabled: false },
      "Pre",
    );
    const gapText = gap.warnings.join(" ");
    expect(gapText).toContain("NV Energy NMR-B (rate 36)");
    expect(gapText).toContain("data gap");
    expect(gapText).toContain("Exports are treated as $0");
    expect(gap.rate?.export_credit_kwh).toBe(0);
    expect(gap.nem?.export_credit_enabled).toBe(false);

    const unconfirmed = normalizeRatePair(
      { id: 11, name: "B-1", fixed_monthly_charge: 5, last_verified_at: null },
      {
        id: 84,
        name: "PG&E B-1 NEM-2",
        is_nem_schedule: true,
        nem_type: "nem2",
        netting: "monthly",
        export_credit_scope: "energy_only",
        export_credit_basis: null,
      },
      "Pre",
    );
    const text = unconfirmed.warnings.join(" ");
    expect(text).toContain("PG&E B-1 NEM-2 (rate 84)");
    expect(text).toContain("none is assumed");
    expect(text).toContain("Exports are treated as $0");
    expect(text).toContain("netting is monthly");
    expect(text).toContain("energy_only");
    expect(unconfirmed.rate?.export_credit_kwh).toBe(0);
    expect(unconfirmed.nem?.export_credit_basis).toBeNull();
    expect(unconfirmed.verification.last_verified_at).toBeNull();
  });
});

describe("battery incentives", () => {
  it("uses incentive rows, then project.itc_pct, and a simple MACRS shield", () => {
    const study = normalizeProjectExport({
      schema_version: 1,
      project: {
        id: "p",
        name: "Incentives",
        federal_tax_rate: 30,
        state_tax_rate: 8,
        use_macrs: false,
        itc_pct: null,
        itc_adders: null,
        critical_load_pct: null,
        backup_hours_target: null,
        cost_adders: [{ name: "freight" }],
        incentives: [
          {
            incentive_name: "Federal Investment Tax Credit (ITC)",
            incentive_type: "tax_credit",
            value: 30,
            cap_amount: null,
            applies_to: "system",
            credit_level: "federal",
            applies_battery_ids: [],
            payout_timing: null,
            spread_years: null,
          },
          { incentive_type: "depreciation", value: 100, incentive_name: "Federal MACRS Depreciation" },
          { incentive_type: "tax_credit", value: 10, incentive_name: "Domestic Content Adder to ITC", applies_to: "system" },
          { incentive_type: "tax_credit", value: 20, incentive_name: "Solar only", applies_to: "solar" },
        ],
      },
      batteries: [catalogRow({ id: "b1" })],
      sunddaddy_results: [
        {
          post_rate_id: 3,
          dispatch_strategy: "combined",
          annual_savings: 1000,
          payback_years: 8,
          npv: 5000,
          irr: 0.12,
          monthly_bills: { pre_usd: new Array<number>(12).fill(100), post_usd: new Array<number>(12).fill(80) },
          computed_at: "2026-09-01T00:00:00Z",
          stale: true,
        },
      ],
    });
    expect(study.finance.federal_tax_rate).toBeCloseTo(0.3);
    expect(study.finance.state_tax_rate).toBeCloseTo(0.08);
    expect(study.finance.cost_adders_present).toBe(true);
    expect(study.finance.itc_pct).toBeNull();
    expect(study.sunddaddy_results[0]?.stale).toBe(true);
    expect(study.sunddaddy_results[0]?.annual_savings).toBe(1000);
    expect(study.sunddaddy_results[0]?.monthly_bills?.pre_usd).toHaveLength(12);

    const fromRows = quote(study.finance, "b1");
    expect(fromRows.itcSource).toBe("incentives");
    expect(fromRows.itcFraction).toBeCloseTo(0.4);
    expect(fromRows.simplePaybackYears).toBeCloseTo(6);
    expect(fromRows.macrsModeled).toBe(false);
    expect(fromRows.notModeled.join(" ")).toContain("Cost adders are not modeled.");
    expect(fromRows.notModeled.join(" ")).toContain("MACRS is not modeled.");
    expect(fromRows.notes.join(" ")).toContain("not apply");

    const withProject: ProjectFinance = { ...study.finance, itc_pct: 0.3, itc_adders: 0.1, use_macrs: true };
    const macrs = quote(withProject, "b1");
    expect(macrs.itcSource).toBe("project_itc_pct");
    expect(macrs.itcFraction).toBeCloseTo(0.4);
    expect(macrs.macrsModeled).toBe(true);
    const shields = [0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576].map((pct) => 80000 * pct * 0.38);
    expect(macrs.npvUsd).toBeCloseTo(40000 + shields.reduce((sum, value) => sum + value, 0));
    expect(macrs.paybackYears).not.toBeNull();
    expect(macrs.paybackYears ?? 99).toBeLessThan(6);
    expect(macrs.notModeled.join(" ")).toContain("payout timing");
    expect(macrs.notModeled.join(" ")).toContain("federal deduction for state");
  });
});

function quote(finance: ProjectFinance, batteryId: string) {
  return incentiveOutcome({
    installedCostUsd: 100000,
    annualSavingsUsd: 10000,
    degradationPerYear: 0,
    rateEscalator: 0,
    discountRate: 0,
    analysisYears: 10,
    finance,
    batteryId,
  });
}

describe("backup recommendation", () => {
  it("uses reserve and continuous kW, and flags a kW limit", () => {
    const battery = handBattery({
      round_trip_efficiency: 1,
      min_reserve_pct: 10,
      continuous_kw: 5,
      peak_kw: 40,
    });
    const recommendation = recommendBackup({
      battery,
      quantity: 1,
      averageLoadKw: 10,
      targetHours: [4, 8],
    });
    expect(recommendation.deliverableAcKwh).toBeCloseTo(90);
    expect(recommendation.powerKw).toBe(5);
    const full = recommendation.shares.find((share) => share.loadFraction === 1);
    const half = recommendation.shares.find((share) => share.loadFraction === 0.5);
    expect(full).toMatchObject({ hours: 0, limitedBy: "kw" });
    expect(half?.hours).toBeCloseTo(18);
    expect(half?.limitedBy).toBe("kwh");
    expect(recommendation.targets[0]).toMatchObject({
      targetHours: 4,
      percentOfBuilding: 50,
      limitedBy: "kw",
      wholeBuildingMeetsTarget: false,
    });
    expect(recommendation.targets[1]?.percentOfBuilding).toBeCloseTo(50);

    const open = recommendBackup({
      battery: handBattery({ round_trip_efficiency: 1 }),
      quantity: 1,
      averageLoadKw: 10,
      targetHours: [4],
    });
    expect(open.deliverableAcKwh).toBeCloseTo(100);
    expect(open.powerKw).toBe(50);
    expect(open.shares[0]).toMatchObject({ hours: 10, limitedBy: "kwh" });
    expect(open.targets[0]?.wholeBuildingMeetsTarget).toBe(true);
  });
});
