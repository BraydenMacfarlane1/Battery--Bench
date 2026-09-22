import { describe, expect, it } from "vitest";
import fixtureA from "../src/fixtures/example-a.snapshot.json";
import { peakShaveDemand, sizeBessSnapshot } from "../src/sizing/engine";

describe("monthly RULE_OF_THUMB path", () => {
  const monthly = {
    ...fixtureA,
    interval_kw_optional: null,
  };

  it("prices the design-month peak before a duration is chosen", () => {
    const demand = peakShaveDemand(monthly);
    expect(demand.peak_kw).toBe(220);
    expect(demand.season).toBe("summer");
    expect(demand.p_batt_kw).toBe(60);
    expect(demand.demand_rate_usd_per_kw_mo).toBe(18.85);
    expect(demand.facilities_usd_per_kw).toBe(4.36);
    expect(demand.power_usd_per_kw).toBe(14.49);
    expect(demand.gross_demand_savings_usd_mo).toBe(1131);
    expect(demand.tariff_as_of).toBe("2026-08-10");
  });

  it("requires a duration preset for usable energy", () => {
    expect(() => sizeBessSnapshot(monthly)).toThrow(/duration_h_preset/);
  });

  it("sizes energy as power times the preset", () => {
    const result = sizeBessSnapshot({
      ...monthly,
      sizing: { ...fixtureA.sizing, duration_h_preset: 2 },
    });
    expect(result.quality).toBe("RULE_OF_THUMB");
    expect(result.p_batt_kw).toBe(60);
    expect(result.e_usable_kwh).toBe(120);
    expect(result.e_nameplate_kwh).toBe(197.4);
    expect(result.duration_h).toBe(2);
    expect(result.catalog_snap).toEqual({ pack_kwh: 100, count: 2, nameplate_kwh: 200 });
    expect(result.gross_demand_savings_usd_mo).toBe(1131);
    expect(result.flags).not.toContain("synthetic_interval_fixture");
  });

  it("uses the winter power rate for an October–May peak", () => {
    const result = sizeBessSnapshot({
      sizing: { use_case: "peak_shave", target_kw: 160, duration_h_preset: 1 },
      segments: [{ start_date: "2026-01-15", peak_demand_kw: 220 }],
    });
    expect(result.demand_rate_usd_per_kw_mo).toBe(17.18);
    expect(result.gross_demand_savings_usd_mo).toBe(1030.8);
    expect(result.p_batt_kw).toBe(60);
  });

  it("rejects a TOU use case in v1", () => {
    expect(() =>
      sizeBessSnapshot({
        sizing: { use_case: "tou", target_kw: 160, duration_h_preset: 1 },
        segments: [{ start_date: "2026-07-01", peak_demand_kw: 220 }],
      }),
    ).toThrow(/TODO/);
  });
});
