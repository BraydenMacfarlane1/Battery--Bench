import { describe, expect, it } from "vitest";
import { loadCsv } from "../src/sizing/csv";

describe("csv", () => {
  it("reads a monthly bill", () => {
    const loaded = loadCsv("start_date,peak_demand_kw,total_kwh\n2026-07-01,220,42000\n");
    expect(loaded).toEqual({
      kind: "monthly",
      rows: [{ startDate: "2026-07-01", peakKw: 220, totalKwh: 42000 }],
    });
  });

  it("reads 15-minute intervals and infers the step", () => {
    const loaded = loadCsv(
      "ts,kw\n2026-07-15T14:00:00-06:00,180\n2026-07-15T14:15:00-06:00,220\n",
    );
    expect(loaded.kind).toBe("interval");
    if (loaded.kind !== "interval") return;
    expect(loaded.points).toEqual([
      { ts: "2026-07-15T14:00:00-06:00", kw: 180 },
      { ts: "2026-07-15T14:15:00-06:00", kw: 220 },
    ]);
    expect(loaded.intervalMinutes).toBe(15);
  });
});
