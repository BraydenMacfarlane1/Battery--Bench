import { describe, expect, it } from "vitest";
import { exampleBPoints, exampleBTargetKw } from "../src/fixtures/example-b";
import { sizeBessSnapshot } from "../src/sizing/engine";

describe("fixture B", () => {
  it("locks the warehouse plateau", () => {
    const result = sizeBessSnapshot({
      pre_rate: {
        as_of: "2026-08-10",
        facilities_usd_per_kw: 4.36,
        power_usd_per_kw: { summer: 14.49, winter: 12.82 },
        schedule_code: "6",
      },
      sizing: {
        use_case: "peak_shave",
        target_kw: exampleBTargetKw,
        soc_min_pct: 20,
        soc_max_pct: 100,
        eta_discharge: 0.95,
        eol_retention: 0.8,
        site: { placement: "outdoor_pad", setback_ft_assumed: 10 },
      },
      interval_kw_optional: {
        quality: "RULE_OF_THUMB",
        interval_minutes: 15,
        points: exampleBPoints,
      },
    });

    expect(result.p_batt_kw).toBe(70);
    expect(result.e_usable_kwh).toBe(132.5);
    expect(result.e_nameplate_kwh).toBe(217.9);
    expect(result.duration_h).toBe(1.89);
    expect(result.demand_rate_usd_per_kw_mo).toBe(18.85);
    expect(result.gross_demand_savings_usd_mo).toBe(1319.5);
    expect(result.catalog_snap).toEqual({ pack_kwh: 60, count: 4, nameplate_kwh: 240 });
    expect(result.assumptions.tariff_as_of).toBe("2026-08-10");
    expect(result.assumptions.schedule).toBe("RMP_UT_6");
  });
});
