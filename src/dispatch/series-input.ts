import { HOURS_PER_YEAR } from "./calendar";

/** Accepts comma, whitespace, or newline separated hourly kWh. A leading header token is skipped. */
export function parseHourlyNumbers(text: string): number[] {
  const values: number[] = [];
  const tokens = text.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isFinite(value)) {
      if (values.length === 0) continue;
      throw new Error(`Expected a number and found "${token}".`);
    }
    if (value < 0) throw new Error("Hourly kWh cannot be negative.");
    values.push(value);
  }
  if (values.length !== HOURS_PER_YEAR) {
    throw new Error(`Expected 8,760 hourly values and found ${values.length}.`);
  }
  return values;
}

/** One number repeats across the year. Twelve numbers are January through December. Blank clears calibration. */
export function parseBilledPeaks(text: string): (number | null)[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Billed peaks must be zero or positive numbers.");
  }
  if (parts.length === 1) return new Array<number>(12).fill(parts[0]);
  if (parts.length === 12) return parts;
  throw new Error("Enter one billed peak for every month, or a single peak to repeat.");
}
