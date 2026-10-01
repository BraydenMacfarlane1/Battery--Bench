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

/** Internal worksheet export. Options comparison, then the monthly bill table. Values are plain numbers, not currency symbols. */
export function buildReportCsv(report: SizingReport): string {
  const quality = report.dataQuality;
  const incentives = report.incentives;
  const lines: string[] = [
    "INTERNAL - not for customer distribution",
    "Data quality",
    ["Hourly source", csvCell(quality?.hourlySource ?? "not included")].join(","),
    ["Peaks source", csvCell(quality?.peaksSource ?? "not included")].join(","),
    ["Bill check", csvCell(quality?.billCheck ?? "not included")].join(","),
    ["Confidence", csvCell(quality?.confidence ?? "not included")].join(","),
    ["Rate verification", csvCell(quality?.rateVerification ?? "not included")].join(","),
    ["Net metering", csvCell(quality?.nemNote ?? "")].join(","),
    ["Round trip", csvCell(report.efficiencyLabel ?? "")].join(","),
    ["Degradation", csvCell(report.degradationLabel ?? "")].join(","),
    "Incentives",
    ["Incentive payback (years)", incentives?.paybackYears == null ? "" : incentives.paybackYears.toFixed(2)].join(","),
    ["Incentive NPV (USD)", incentives?.npvUsd == null ? "" : money(incentives.npvUsd)].join(","),
    ["Incentive notes", csvCell(incentives?.notes.join(" ") ?? "")].join(","),
    "Backup recommendation",
    ...(report.backupRecommendation.length > 0 ? report.backupRecommendation.map((line) => csvCell(line)) : ["none"]),
    "",
    "Options comparison",
    OPTION_HEADERS.join(","),
  ];
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
