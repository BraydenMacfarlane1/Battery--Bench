import type { SizingReport } from "./types";

const OPTION_HEADERS = [
  "Battery",
  "Quantity",
  "Annual savings (USD)",
  "Payback (years)",
  "NPV (USD)",
  "Peak reduction (kW)",
  "Self-consumption (%)",
  "Equivalent cycles",
  "Backup hours",
] as const;

const MONTH_HEADERS = ["Month", "Baseline (USD)", "With battery (USD)", "Savings (USD)"] as const;

/** Options comparison, then the monthly bill table. Values are plain numbers, not currency symbols. */
export function buildReportCsv(report: SizingReport): string {
  const lines: string[] = ["Options comparison", OPTION_HEADERS.join(",")];
  for (const row of report.options) {
    lines.push(
      [
        csvCell(row.battery),
        String(row.quantity),
        money(row.annualSavingsUsd),
        row.paybackYears == null ? "" : row.paybackYears.toFixed(2),
        row.npvUsd == null ? "" : money(row.npvUsd),
        row.peakReductionKw.toFixed(1),
        row.selfConsumptionPct == null ? "" : (row.selfConsumptionPct * 100).toFixed(1),
        row.cycles.toFixed(0),
        row.backupHours == null ? "" : row.backupHours.toFixed(1),
      ].join(","),
    );
  }
  lines.push("", "Monthly bills", MONTH_HEADERS.join(","));
  for (const month of report.months) {
    lines.push(
      [csvCell(month.month), money(month.baselineUsd), money(month.withBatteryUsd), money(month.savingsUsd)].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function money(value: number): string {
  return value.toFixed(2);
}

export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
