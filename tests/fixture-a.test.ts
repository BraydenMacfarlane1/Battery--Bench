import { describe, expect, it } from "vitest";
import fixtureA from "../src/fixtures/example-a.snapshot.json";
import { sizeBessSnapshot } from "../src/sizing/engine";
import { expectedExampleA } from "./expected-a";

describe("fixture A", () => {
  it("locks the retail spike", () => {
    expect(sizeBessSnapshot(fixtureA)).toEqual(expectedExampleA);
  });

  it("keeps the same energy when the synthetic series is marked FACT, without the synthetic flag", () => {
    const fact = {
      ...fixtureA,
      interval_kw_optional: {
        ...fixtureA.interval_kw_optional,
        quality: "FACT" as const,
      },
    };
    const result = sizeBessSnapshot(fact);
    expect(result.p_batt_kw).toBe(60);
    expect(result.e_usable_kwh).toBe(71.25);
    expect(result.e_nameplate_kwh).toBe(117.2);
    expect(result.quality).toBe("FACT");
    expect(result.flags).toEqual([
      "outdoor_setback_default_10ft_confirm_AHJ",
      "not_a_code_or_engineering_stamp",
    ]);
  });
});
