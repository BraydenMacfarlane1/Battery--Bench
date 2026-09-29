import { describe, expect, it } from "vitest";
import { parseBilledPeaks, parseHourlyNumbers } from "../src/dispatch/series-input";

describe("hourly series input", () => {
  it("parses 8760 numbers and skips a leading header", () => {
    const values = parseHourlyNumbers(["kwh", ...Array.from({ length: 8760 }, (_, index) => String(index % 7))].join("\n"));
    expect(values).toHaveLength(8760);
    expect(values[1]).toBe(1);
  });

  it("rejects the wrong length and negative hours", () => {
    expect(() => parseHourlyNumbers("1, 2, 3")).toThrow(/8,760/);
    expect(() => parseHourlyNumbers(["-1", ...Array.from({ length: 8759 }, () => "0")].join(","))).toThrow(/negative/);
  });

  it("repeats one billed peak and accepts twelve", () => {
    expect(parseBilledPeaks("")).toBeNull();
    expect(parseBilledPeaks("140")).toEqual(new Array(12).fill(140));
    expect(parseBilledPeaks("1,2,3,4,5,6,7,8,9,10,11,12")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(() => parseBilledPeaks("1, 2")).toThrow(/every month/);
  });
});
