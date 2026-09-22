import { describe, expect, it } from "vitest";
import { coveringSnaps, snapCatalog } from "../src/sizing/catalog";

describe("catalog snap", () => {
  it("covers example A with 2 × 60 and keeps 3 × 40 as the same-kWh alternate", () => {
    expect(snapCatalog(71.25 / 0.608)).toEqual({ pack_kwh: 60, count: 2, nameplate_kwh: 120 });
    expect(coveringSnaps(71.25 / 0.608).map((snap) => snap.nameplate_kwh)).toEqual([120, 120]);
  });

  it("covers example B at 240 kWh with 4 × 60", () => {
    expect(snapCatalog(132.5 / 0.608)).toEqual({ pack_kwh: 60, count: 4, nameplate_kwh: 240 });
  });

  it("does not return a stack below the required nameplate", () => {
    const required = 217.9;
    for (const snap of coveringSnaps(required)) {
      expect(snap.nameplate_kwh).toBeGreaterThanOrEqual(required);
    }
  });
});
