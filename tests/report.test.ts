import { describe, expect, it } from "vitest";
import { buildReportCsv } from "../src/report/csv";
import { buildReportPdf } from "../src/report/pdf";
import type { SizingReport } from "../src/report/types";

function sampleReport(): SizingReport {
  return {
    generatedAt: "Sep 30, 2026, 9:00 AM",
    customerName: "Northwind",
    projectName: "Warehouse, phase 1",
    utilityName: "Example Electric",
    rateName: "Synthetic example rate",
    annualLoadKwh: 500000,
    peakKw: 120,
    annualSolarKwh: 180000,
    batteryName: "Small cabinet",
    quantity: 2,
    goal: "Max annual savings",
    annualSavingsUsd: 12345.5,
    paybackYears: 6.25,
    npvUsd: 40000,
    peakReductionKw: 18.2,
    selfConsumptionPct: 0.81,
    installedCostUsd: 50000,
    backupHeadline: "About 4.0 hours (conservative 2.5 hours)",
    options: [
      {
        battery: "Small cabinet",
        quantity: 2,
        annualSavingsUsd: 12345.5,
        paybackYears: 6.25,
        npvUsd: 40000,
        peakReductionKw: 18.2,
        selfConsumptionPct: 0.81,
        cycles: 240,
        backupHours: 4,
      },
      {
        battery: 'Large "cabinet"',
        quantity: 1,
        annualSavingsUsd: 9000,
        paybackYears: null,
        npvUsd: null,
        peakReductionKw: 10,
        selfConsumptionPct: null,
        cycles: 80,
        backupHours: null,
      },
    ],
    months: [
      { month: "Jan", baselineUsd: 1000, withBatteryUsd: 800, savingsUsd: 200 },
      { month: "Year", baselineUsd: 12000, withBatteryUsd: 9600, savingsUsd: 2400 },
    ],
    assumptions: ["Hourly resolution only."],
    limitations: ["Not an engineering stamp."],
    dataQuality: {
      hourlySource: "Measured",
      peaksSource: "billed",
      billCheck: "Not verified: no bills to check against",
      confidence: "Medium",
      rateVerification: "Rate not verified",
      nemNote: "NV Energy NMR-B (rate 36) has export credits turned off in Sun Daddy. Exports are treated as $0 in this bill.",
    },
    incentives: {
      paybackYears: 4.5,
      npvUsd: 12000,
      notes: ["Not modeled: MACRS is not modeled."],
    },
    backupRecommendation: ["100% of average load: 6.0 h (limited by kWh)", "4 h target: whole building is covered."],
    efficiencyLabel: "90% assumption (battery spec not set)",
    degradationLabel: "2% per year assumption (battery spec not set)",
  };
}

describe("report export", () => {
  it("writes the options comparison and the monthly bills as CSV", () => {
    const csv = buildReportCsv(sampleReport());
    expect(csv).toBe(
      [
        "INTERNAL - not for customer distribution",
        "Data quality",
        "Hourly source,Measured",
        "Peaks source,billed",
        "Bill check,Not verified: no bills to check against",
        "Confidence,Medium",
        "Rate verification,Rate not verified",
        "Net metering,NV Energy NMR-B (rate 36) has export credits turned off in Sun Daddy. Exports are treated as $0 in this bill.",
        "Round trip,90% assumption (battery spec not set)",
        "Degradation,2% per year assumption (battery spec not set)",
        "Incentives",
        "Incentive payback (years),4.50",
        "Incentive NPV (USD),12000.00",
        "Incentive notes,Not modeled: MACRS is not modeled.",
        "Backup recommendation",
        "100% of average load: 6.0 h (limited by kWh)",
        "4 h target: whole building is covered.",
        "",
        "Options comparison",
        "Battery,Quantity,Annual savings (USD),Payback (years),NPV (USD),Peak reduction (kW),Self-consumption (%),Equivalent cycles,Backup hours",
        "Small cabinet,2,12345.50,6.25,40000.00,18.2,81.0,240,4.0",
        '"Large ""cabinet""",1,9000.00,,,10.0,,80,',
        "",
        "Monthly bills",
        "Month,Baseline (USD),With battery (USD),Savings (USD)",
        "Jan,1000.00,800.00,200.00",
        "Year,12000.00,9600.00,2400.00",
        "",
      ].join("\n"),
    );
  });

  it("builds a PDF that starts with the PDF header and names the customer", async () => {
    const bytes = buildReportPdf(sampleReport());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.slice(0, 5)).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(800);
    expect(text).toContain("Battery Bench");
    expect(text).toContain("Northwind");
    expect(text).toContain("Small cabinet");
    expect(text).toContain("Not an engineering stamp.");
    expect(text).toContain("INTERNAL - not for customer distribution");
    expect(text).toContain("Not verified: no bills to check against");
    expect(text).toContain("Incentive payback");
  });
});