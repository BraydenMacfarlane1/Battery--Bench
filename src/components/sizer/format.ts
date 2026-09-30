import { DAYS_IN_MONTH } from "../../dispatch/calendar";
import { formatUsd } from "../../sizing/tariff";

export function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatUsd(value);
}

export function years(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} yr`;
}

export function signedMoney(value: number): string {
  const formatted = formatUsd(value);
  if (value > 0.004 && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

export function signedYears(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} yr`;
}

export function formatCount(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function projectCountLabel(count: number): string {
  return count === 1 ? "1 project" : `${formatCount(count)} projects`;
}

export function friendlyToken(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[_-]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function formatUpdated(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function monthStamp(hour: number): { month: string; day: number } {
  let cursor = 0;
  for (let month = 0; month < 12; month += 1) {
    const hours = DAYS_IN_MONTH[month] * 24;
    if (hour < cursor + hours) return { month: MONTH_LONG[month], day: Math.floor((hour - cursor) / 24) + 1 };
    cursor += hours;
  }
  return { month: "December", day: 31 };
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function peakOf(values: readonly number[]): number {
  let peak = 0;
  for (const value of values) if (value > peak) peak = value;
  return peak;
}
