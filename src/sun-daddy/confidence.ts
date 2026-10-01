import type { BillCheck, HourlySourceKind, NemScheduleInfo } from "./types";

/**
 * Overall confidence is the worst credible reading of three independent facts.
 * It is a label for the worksheet, not a probability.
 *
 * Lower when any of these is true:
 * - bill-check grade is C or D
 * - bill-check status is blocked or error
 * - hourly source is building_type_shape
 * - hourly source is unknown and the bill check is not grade A or B
 *
 * Higher only when all of these are true:
 * - hourly source is measured
 * - bill-check grade is A or B
 * - the rate has last_verified_at
 *
 * Medium is everything else. That includes measured or synthesized hourly data
 * with no_actuals: no_actuals means no bills were imported to check against.
 * It is not a pass, it is not green, and it does not by itself force Lower.
 * A missing last_verified_at blocks Higher and is labeled "rate not verified".
 * It does not by itself force Lower.
 */
export type ConfidenceLabel = "Higher" | "Medium" | "Lower";

export type BillCheckTone = "neutral" | "good" | "bad";

export type BillCheckView = {
  tone: BillCheckTone;
  title: string;
  detail: string | null;
  /** Set for grades C and D. Null otherwise, including no_actuals. */
  savingsWarning: string | null;
};

export function billCheckView(check: BillCheck | null): BillCheckView {
  if (!check || check.status == null) {
    return { tone: "neutral", title: "Bill check was not included", detail: null, savingsWarning: null };
  }
  if (check.status === "no_actuals") {
    return {
      tone: "neutral",
      title: "Not verified: no bills to check against",
      detail: null,
      savingsWarning: null,
    };
  }
  if (check.status === "blocked") {
    return {
      tone: "bad",
      title: check.blocked_reason ? `Bill check blocked: ${check.blocked_reason}` : "Bill check blocked",
      detail: null,
      savingsWarning: "Savings are less reliable until the bill check can run.",
    };
  }
  if (check.status === "error") {
    return {
      tone: "bad",
      title: "Bill check failed",
      detail: check.notes,
      savingsWarning: "Savings are less reliable. The bill check returned an error.",
    };
  }
  const delta = deltaText(check);
  if (check.grade === "C" || check.grade === "D") {
    return {
      tone: "bad",
      title: `Bill check grade ${check.grade}`,
      detail: delta,
      savingsWarning: `Savings are less reliable. The bill check grade is ${check.grade}.`,
    };
  }
  if (check.grade === "A" || check.grade === "B") {
    return {
      tone: "good",
      title: `Bill check grade ${check.grade}`,
      detail: delta,
      savingsWarning: null,
    };
  }
  return { tone: "neutral", title: "Bill check has no grade", detail: delta, savingsWarning: null };
}

export function overallConfidence(args: {
  hourlyKind: HourlySourceKind;
  bill: BillCheck | null;
  rateVerified: boolean;
}): ConfidenceLabel {
  const grade = args.bill?.grade ?? null;
  const status = args.bill?.status ?? null;
  if (grade === "C" || grade === "D" || status === "blocked" || status === "error") return "Lower";
  if (args.hourlyKind === "building_type_shape") return "Lower";
  if (args.hourlyKind === "unknown" && grade !== "A" && grade !== "B") return "Lower";
  if (args.hourlyKind === "measured" && (grade === "A" || grade === "B") && args.rateVerified) return "Higher";
  return "Medium";
}

export function hourlySourceLabel(kind: HourlySourceKind, raw: string | null): string {
  if (kind === "measured") return "Measured";
  if (kind === "synthesized_from_bills") return "Synthesized from bills";
  if (kind === "building_type_shape") return "Building-type shape";
  if (raw) return raw;
  return "Not named";
}

export function nemPanelNote(warnings: readonly string[], nem: NemScheduleInfo | null): string | null {
  const gap = warnings.find((warning) => warning.includes("Exports are treated as $0"));
  const parts: string[] = [];
  if (gap) parts.push(gap);
  if (nem?.netting && !HOURLY.has(nem.netting.toLowerCase())) {
    parts.push(`Netting simplification: Sun Daddy netting is ${nem.netting}. This bill nets each hour.`);
  }
  if (nem?.export_credit_scope && !FULL_BILL.has(nem.export_credit_scope.toLowerCase())) {
    parts.push(
      `Export credits are applied to the full bill here. Sun Daddy's export credit scope is ${nem.export_credit_scope}.`,
    );
  }
  if (nem?.export_credit_basis) {
    parts.push(`Export credit basis (${nem.export_credit_basis}) is not modeled.`);
  }
  if (parts.length === 0) return null;
  return dedupe(parts).join(" ");
}

const HOURLY = new Set(["hourly", "interval", "intervals"]);
const FULL_BILL = new Set(["full_bill", "full", "bill"]);

function deltaText(check: BillCheck): string | null {
  const annual = check.annual;
  if (!annual) return null;
  const bits: string[] = [];
  if (annual.delta_pct != null) bits.push(`annual difference ${formatNumber(annual.delta_pct)}%`);
  if (annual.actual != null && annual.modeled != null) {
    bits.push(`actual ${formatMoney(annual.actual)}, modeled ${formatMoney(annual.modeled)}`);
  }
  return bits.length > 0 ? bits.join("; ") : null;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}
