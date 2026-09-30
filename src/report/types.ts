export type ReportOptionRow = {
  battery: string;
  quantity: number;
  annualSavingsUsd: number;
  paybackYears: number | null;
  npvUsd: number | null;
  peakReductionKw: number;
  selfConsumptionPct: number | null;
  cycles: number;
  backupHours: number | null;
};

export type ReportMonthRow = {
  month: string;
  baselineUsd: number;
  withBatteryUsd: number;
  savingsUsd: number;
};

export type SizingReport = {
  generatedAt: string;
  customerName: string;
  projectName: string;
  utilityName: string;
  rateName: string;
  annualLoadKwh: number;
  peakKw: number;
  annualSolarKwh: number;
  batteryName: string;
  quantity: number;
  goal: string;
  annualSavingsUsd: number;
  paybackYears: number | null;
  npvUsd: number | null;
  peakReductionKw: number;
  selfConsumptionPct: number | null;
  installedCostUsd: number;
  backupHeadline: string | null;
  options: ReportOptionRow[];
  months: ReportMonthRow[];
  assumptions: string[];
  limitations: string[];
};
