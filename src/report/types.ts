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

export type ReportDataQuality = {
  hourlySource: string;
  peaksSource: string;
  billCheck: string;
  confidence: string;
  rateVerification: string;
  nemNote: string | null;
};

export type ReportIncentives = {
  paybackYears: number | null;
  npvUsd: number | null;
  notes: string[];
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
  /** Null when the study did not come from Sun Daddy. */
  dataQuality: ReportDataQuality | null;
  /** Null when the incentive column could not be calculated. */
  incentives: ReportIncentives | null;
  backupRecommendation: string[];
  efficiencyLabel: string | null;
  degradationLabel: string | null;
};
