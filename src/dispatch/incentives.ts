import type { ProjectFinance, ProjectIncentive } from "../sun-daddy/types";
import {
  internalRateOfReturn,
  netPresentValue,
  savingsCashFlows,
  simplePaybackYears,
} from "./economics";

/**
 * Incentive-adjusted battery cash flow. The plain-price result stays separate.
 *
 * ITC
 * - When project.itc_pct is set, the credit rate is itc_pct plus itc_adders.
 *   Tax-credit rows are not added again.
 * - Otherwise each tax_credit incentive that applies to this battery contributes
 *   its value as a percent of installed cost, capped by cap_amount when that is set.
 * - applies_to solar/pv is skipped. battery, storage, system, project, all, or a
 *   blank applies_to are included. A non-empty applies_battery_ids list must name
 *   this battery.
 * - A year-0 credit is assumed. spread_years splits that credit across years 1..N.
 *   payout_timing is not modeled.
 *
 * MACRS
 * - Modeled only when use_macrs is true and a federal or state tax rate is set.
 * - 5-year half-year IRS schedule: 20%, 32%, 19.2%, 11.52%, 11.52%, 5.76%.
 * - Basis is installed cost minus half of the ITC dollars taken, times the
 *   depreciable share. The share is the depreciation incentive's value when one
 *   applies to the battery, otherwise 100%.
 * - The tax shield is basis × schedule × (federal + state). The federal deduction
 *   for state income tax is not modeled. Bonus depreciation is not modeled.
 * - Shield years past the analysis period are dropped.
 *
 * Cost adders are carried and not priced. Battery equipment cost from Sun Daddy
 * is not substituted for the catalog installed cost.
 */
const MACRS_5_YEAR = [0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576] as const;

const SOLAR_ONLY = new Set(["solar", "pv", "generation", "pv_only"]);
const BATTERY_OR_SYSTEM = new Set(["", "battery", "storage", "bess", "system", "project", "all"]);

export type IncentiveOutcome = {
  /** Installed cost after year-0 tax credits only. MACRS is not subtracted here. */
  netCostYear0Usd: number;
  itcFraction: number;
  itcUsd: number;
  itcSource: "project_itc_pct" | "incentives" | "none";
  macrsModeled: boolean;
  /** Undiscounted year the cumulative incentive cash flow crosses zero. */
  paybackYears: number | null;
  /** Simple payback on the year-0 net cost. Blank when first-year savings are not positive. */
  simplePaybackYears: number | null;
  npvUsd: number;
  irr: number | null;
  notModeled: string[];
  notes: string[];
};

export function incentiveOutcome(args: {
  installedCostUsd: number;
  annualSavingsUsd: number;
  degradationPerYear: number;
  rateEscalator: number;
  discountRate: number;
  analysisYears: number;
  finance: ProjectFinance | null;
  batteryId: string | null;
}): IncentiveOutcome {
  const finance = args.finance;
  const notes: string[] = [];
  const notModeled: string[] = [
    "Incentive payout timing is not modeled.",
    "The federal deduction for state income tax is not modeled.",
    "Bonus depreciation is not modeled.",
  ];
  if (finance?.cost_adders_present) notModeled.push("Cost adders are not modeled.");
  if (!finance) {
    notModeled.push("No project incentive inputs were loaded.");
    return emptyOutcome(args, notes, notModeled);
  }

  const applicable = finance.incentives.filter((row) => incentiveApplies(row, args.batteryId));
  const skipped = finance.incentives.length - applicable.length;
  if (skipped > 0) {
    notes.push(
      `${skipped} incentive ${skipped === 1 ? "row does" : "rows do"} not apply to this battery and ${skipped === 1 ? "was" : "were"} left out.`,
    );
  }

  const itc = resolveItc(finance, applicable, args.installedCostUsd, notes, notModeled);
  const plainFlows = savingsCashFlows({
    installedCostUsd: args.installedCostUsd,
    annualSavingsUsd: args.annualSavingsUsd,
    degradationPerYear: args.degradationPerYear,
    rateEscalator: args.rateEscalator,
    analysisYears: args.analysisYears,
  });
  const flows = plainFlows.slice();
  flows[0] += itc.year0Usd;
  for (const [year, dollars] of itc.later) {
    if (year >= 1 && year < flows.length) flows[year] += dollars;
  }

  const macrs = resolveMacrs(finance, applicable, args.installedCostUsd, itc.totalUsd, notes, notModeled);
  if (macrs.modeled) {
    macrs.shields.forEach((dollars, index) => {
      const year = index + 1;
      if (year < flows.length) flows[year] += dollars;
      else notModeled.push("MACRS deductions after the analysis period are dropped.");
    });
  }

  const year0Net = Math.max(0, args.installedCostUsd - itc.year0Usd);
  const adjusted = itc.totalUsd > 1e-6 || macrs.modeled;
  return {
    netCostYear0Usd: args.installedCostUsd - itc.year0Usd,
    itcFraction: itc.fraction,
    itcUsd: itc.totalUsd,
    itcSource: itc.source,
    macrsModeled: macrs.modeled,
    paybackYears: adjusted ? cumulativePayback(flows) : simplePaybackYears(args.installedCostUsd, args.annualSavingsUsd),
    simplePaybackYears: simplePaybackYears(year0Net, args.annualSavingsUsd),
    npvUsd: netPresentValue(args.discountRate, adjusted ? flows : plainFlows),
    irr: internalRateOfReturn(adjusted ? flows : plainFlows),
    notModeled: dedupe(notModeled),
    notes,
  };
}

export function incentiveApplies(row: ProjectIncentive, batteryId: string | null): boolean {
  if (row.applies_battery_ids.length > 0) {
    if (!batteryId || !row.applies_battery_ids.includes(batteryId)) return false;
  }
  const target = (row.applies_to ?? "").trim().toLowerCase();
  if (SOLAR_ONLY.has(target)) return false;
  return BATTERY_OR_SYSTEM.has(target);
}

function resolveItc(
  finance: ProjectFinance,
  applicable: readonly ProjectIncentive[],
  installed: number,
  notes: string[],
  notModeled: string[],
): { fraction: number; totalUsd: number; year0Usd: number; later: Array<[number, number]>; source: IncentiveOutcome["itcSource"] } {
  if (finance.itc_pct != null) {
    const adders = finance.itc_adders ?? 0;
    const fraction = Math.max(0, finance.itc_pct + adders);
    const dollars = installed * fraction;
    notes.push("ITC percent comes from project.itc_pct and itc_adders. Tax-credit rows were not added again.");
    if (applicable.some((row) => row.incentive_type === "tax_credit" && row.cap_amount != null)) {
      notModeled.push("Incentive caps are not applied when project.itc_pct is set.");
    }
    return { fraction, totalUsd: dollars, year0Usd: dollars, later: [], source: "project_itc_pct" };
  }

  let total = 0;
  let year0 = 0;
  const later: Array<[number, number]> = [];
  let any = false;
  for (const row of applicable) {
    if ((row.incentive_type ?? "").toLowerCase() !== "tax_credit") continue;
    any = true;
    if (row.value == null) {
      notes.push(`${row.incentive_name ?? "A tax credit"} had no value and was skipped.`);
      continue;
    }
    let dollars = installed * (row.value / 100);
    if (row.cap_amount != null && row.cap_amount >= 0) dollars = Math.min(dollars, row.cap_amount);
    total += dollars;
    const spread = row.spread_years;
    if (spread != null && Number.isInteger(spread) && spread > 1) {
      const each = dollars / spread;
      for (let year = 1; year <= spread; year += 1) later.push([year, each]);
      notes.push(`${row.incentive_name ?? "A tax credit"} is spread over ${spread} years.`);
    } else {
      year0 += dollars;
    }
  }
  if (!any) {
    notes.push("No battery tax credit is set on this project.");
    return { fraction: 0, totalUsd: 0, year0Usd: 0, later: [], source: "none" };
  }
  const fraction = installed > 0 ? total / installed : 0;
  return { fraction, totalUsd: total, year0Usd: year0, later, source: "incentives" };
}

function resolveMacrs(
  finance: ProjectFinance,
  applicable: readonly ProjectIncentive[],
  installed: number,
  itcUsd: number,
  notes: string[],
  notModeled: string[],
): { modeled: boolean; shields: number[] } {
  if (finance.use_macrs !== true) {
    notModeled.push("MACRS is not modeled.");
    return { modeled: false, shields: [] };
  }
  const federal = finance.federal_tax_rate;
  const state = finance.state_tax_rate;
  if (federal == null && state == null) {
    notModeled.push("MACRS tax shield is not modeled (no federal or state tax rate).");
    return { modeled: false, shields: [] };
  }
  const tax = (federal ?? 0) + (state ?? 0);
  const depreciation = applicable.find((row) => (row.incentive_type ?? "").toLowerCase() === "depreciation");
  let share = 1;
  if (depreciation?.value != null) {
    share = depreciation.value / 100;
    notes.push(`Depreciable share is ${depreciation.value}% from the depreciation incentive.`);
  } else {
    notes.push("Depreciable share was not on an incentive row. 100% of the ITC-adjusted basis is used because use_macrs is set.");
  }
  if (!(share > 0)) {
    notModeled.push("MACRS is not modeled (depreciable share is not positive).");
    return { modeled: false, shields: [] };
  }
  const basis = Math.max(0, installed - 0.5 * itcUsd) * share;
  notes.push("MACRS uses the 5-year half-year schedule on installed cost minus half the ITC.");
  if (tax === 0) notes.push("Tax rates are 0, so the MACRS shield is $0.");
  return { modeled: true, shields: MACRS_5_YEAR.map((pct) => basis * pct * tax) };
}

function cumulativePayback(flows: readonly number[]): number | null {
  let cum = flows[0] ?? 0;
  if (cum >= -1e-9) return 0;
  for (let year = 1; year < flows.length; year += 1) {
    const add = flows[year] ?? 0;
    if (cum + add >= -1e-9) {
      if (!(add > 1e-9)) return year;
      return year - 1 + -cum / add;
    }
    cum += add;
  }
  return null;
}

function emptyOutcome(
  args: { installedCostUsd: number; annualSavingsUsd: number; degradationPerYear: number; rateEscalator: number; discountRate: number; analysisYears: number },
  notes: string[],
  notModeled: string[],
): IncentiveOutcome {
  const flows = savingsCashFlows({
    installedCostUsd: args.installedCostUsd,
    annualSavingsUsd: args.annualSavingsUsd,
    degradationPerYear: args.degradationPerYear,
    rateEscalator: args.rateEscalator,
    analysisYears: args.analysisYears,
  });
  return {
    netCostYear0Usd: args.installedCostUsd,
    itcFraction: 0,
    itcUsd: 0,
    itcSource: "none",
    macrsModeled: false,
    paybackYears: cumulativePayback(flows),
    simplePaybackYears: simplePaybackYears(args.installedCostUsd, args.annualSavingsUsd),
    npvUsd: netPresentValue(args.discountRate, flows),
    irr: internalRateOfReturn(flows),
    notModeled: dedupe(notModeled),
    notes,
  };
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}
