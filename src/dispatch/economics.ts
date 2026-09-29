import { DEFAULT_DEGRADATION_PER_YEAR } from "./assumptions";
import type { Battery } from "./types";

/** Planning defaults, not a forecast. Callers can override every one. */
export const DEFAULT_ANALYSIS_YEARS = 25;
export const DEFAULT_DISCOUNT_RATE = 0.06;
export const DEFAULT_RATE_ESCALATOR = 0.02;

export function installedCost(battery: Battery, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("quantity must be an integer of 1 or more.");
  const first = battery.cost_per_unit;
  const additional = battery.cost_per_additional_unit ?? first;
  if (typeof first !== "number" || !Number.isFinite(first) || first < 0) {
    throw new Error(`${battery.name}: cost_per_unit must be zero or positive.`);
  }
  if (typeof additional !== "number" || !Number.isFinite(additional) || additional < 0) {
    throw new Error(`${battery.name}: cost_per_additional_unit must be zero or positive.`);
  }
  return first + (quantity - 1) * additional;
}

/**
 * Year 0 is the installed cost, as a negative cash flow.
 * Year y savings = first-year savings × (1 − degradation)^(y−1) × (1 + escalator)^(y−1).
 * The simulated year is beginning-of-life capacity. Incentives and income tax are not included.
 */
export function savingsCashFlows(args: {
  installedCostUsd: number;
  annualSavingsUsd: number;
  degradationPerYear: number;
  rateEscalator: number;
  analysisYears: number;
}): number[] {
  const years = args.analysisYears;
  if (!Number.isInteger(years) || years < 1 || years > 100) {
    throw new Error("analysis period must be a whole number of years from 1 to 100.");
  }
  if (!(args.degradationPerYear >= 0 && args.degradationPerYear < 1)) {
    throw new Error("degradation_per_year must be from 0 up to, but not including, 1.");
  }
  if (!(args.rateEscalator > -1)) throw new Error("rate escalator must be greater than -100%.");
  const flows = new Array<number>(years + 1);
  flows[0] = -args.installedCostUsd;
  const retention = 1 - args.degradationPerYear;
  const escalation = 1 + args.rateEscalator;
  for (let year = 1; year <= years; year += 1) {
    flows[year] = args.annualSavingsUsd * retention ** (year - 1) * escalation ** (year - 1);
  }
  return flows;
}

export function netPresentValue(discountRate: number, cashFlows: readonly number[]): number {
  if (!(discountRate > -1)) throw new Error("discount rate must be greater than -100%.");
  let total = 0;
  for (let year = 0; year < cashFlows.length; year += 1) {
    total += cashFlows[year] / (1 + discountRate) ** year;
  }
  return total;
}

/** Unique conventional IRR, or null when the cash flows never change sign. */
export function internalRateOfReturn(cashFlows: readonly number[]): number | null {
  if (cashFlows.length < 2) return null;
  const later = cashFlows.slice(1);
  const anyPositive = later.some((value) => value > 1e-9);
  const anyNegative = later.some((value) => value < -1e-9);
  if (!anyPositive && cashFlows[0] <= 0) return null;
  if (!anyPositive && !anyNegative) return null;
  if (cashFlows[0] >= -1e-9 && anyPositive && !anyNegative) return Number.POSITIVE_INFINITY;

  const low = -0.9;
  const high = 5;
  const npvLow = netPresentValue(low, cashFlows);
  const npvHigh = netPresentValue(high, cashFlows);
  if (npvLow === 0) return low;
  if (npvHigh === 0) return high;
  if (npvLow * npvHigh > 0) return null;

  let lo = low;
  let hi = high;
  for (let step = 0; step < 80; step += 1) {
    const mid = (lo + hi) / 2;
    const value = netPresentValue(mid, cashFlows);
    if (Math.abs(value) < 1e-6) return mid;
    if (netPresentValue(lo, cashFlows) * value > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function simplePaybackYears(installedCostUsd: number, annualSavingsUsd: number): number | null {
  if (!(annualSavingsUsd > 0)) return null;
  if (installedCostUsd <= 0) return 0;
  return installedCostUsd / annualSavingsUsd;
}

export function degradationOf(battery: Battery): number {
  return battery.degradation_per_year ?? DEFAULT_DEGRADATION_PER_YEAR;
}
