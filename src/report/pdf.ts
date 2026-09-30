import { jsPDF } from "jspdf";
import { money, years } from "../components/sizer/format";
import type { SizingReport } from "./types";

const NAVY: [number, number, number] = [14, 42, 67];
const TEAL: [number, number, number] = [15, 92, 86];
const INK: [number, number, number] = [18, 32, 46];
const MUTED: [number, number, number] = [62, 81, 99];

/** One- to three-page letter report. Text is uncompressed so a smoke test can read it. */
export function buildReportPdf(report: SizingReport): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: false });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const width = pageWidth - margin * 2;
  let y = 0;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };

  const ensure = (needed: number) => {
    if (y + needed > pageHeight - 56) newPage();
  };

  const write = (
    text: string,
    size: number,
    style: "normal" | "bold" = "normal",
    color: [number, number, number] = INK,
    gap = 6,
  ) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, width) as string[];
    const lineHeight = size + 4;
    ensure(lines.length * lineHeight);
    doc.text(lines, margin, y);
    y += lines.length * lineHeight + gap;
  };

  doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.rect(0, 0, pageWidth, 78, "F");
  doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
  doc.rect(0, 78, pageWidth, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Battery Bench", margin, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Battery sizing report", margin, 56);
  doc.text(report.generatedAt, pageWidth - margin, 36, { align: "right" });
  y = 110;

  write(`${report.customerName} · ${report.projectName}`, 16, "bold", NAVY, 4);
  write(`Utility: ${report.utilityName}`, 11, "normal", MUTED, 2);
  write(`Rate: ${report.rateName}`, 11, "normal", MUTED, 8);

  write("Load and solar", 13, "bold", NAVY, 4);
  write(
    `Annual load ${formatKwh(report.annualLoadKwh)}. Peak ${formatKw(report.peakKw)}. Solar ${formatKwh(report.annualSolarKwh)} per year.`,
    11,
    "normal",
    INK,
    8,
  );

  write("Recommendation", 13, "bold", NAVY, 4);
  write(`${report.quantity} × ${report.batteryName}`, 14, "bold", TEAL, 2);
  write(`Goal: ${report.goal}`, 11, "normal", MUTED, 4);
  write(
    `Annual savings ${money(report.annualSavingsUsd)}. Payback ${years(report.paybackYears)}. NPV ${money(report.npvUsd)}. Peak reduction ${formatKw(report.peakReductionKw)}. Solar self-consumption ${percent(report.selfConsumptionPct)}. Installed cost ${money(report.installedCostUsd)}.`,
    11,
    "normal",
    INK,
    8,
  );

  if (report.backupHeadline) {
    write("Backup duration", 13, "bold", NAVY, 4);
    write(report.backupHeadline, 11, "normal", INK, 8);
  }

  write("Monthly bills", 13, "bold", NAVY, 6);
  table(
    doc,
    margin,
    () => y,
    (next) => {
      y = next;
    },
    ensure,
    ["Month", "Baseline", "With battery", "Savings"],
    report.months.map((month) => [
      month.month,
      money(month.baselineUsd),
      money(month.withBatteryUsd),
      money(month.savingsUsd),
    ]),
    width,
  );
  y += 10;

  write("Options comparison", 13, "bold", NAVY, 6);
  table(
    doc,
    margin,
    () => y,
    (next) => {
      y = next;
    },
    ensure,
    ["Battery", "Qty", "Savings", "Payback", "NPV", "Peak"],
    report.options.map((row) => [
      trim(row.battery, 22),
      String(row.quantity),
      money(row.annualSavingsUsd),
      years(row.paybackYears),
      money(row.npvUsd),
      formatKw(row.peakReductionKw),
    ]),
    width,
  );
  y += 12;

  write("Assumptions and limitations", 13, "bold", NAVY, 4);
  for (const line of [...report.limitations, ...report.assumptions]) {
    write(`• ${line}`, 9, "normal", MUTED, 2);
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text("Battery Bench is a sizing worksheet, not an engineering stamp or an interconnection approval.", margin, pageHeight - 32);
    doc.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 32, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

function table(
  doc: jsPDF,
  margin: number,
  getY: () => number,
  setY: (value: number) => void,
  ensure: (needed: number) => void,
  headers: string[],
  rows: string[][],
  width: number,
) {
  const columns = headers.length;
  const colW = width / columns;
  const rowH = 16;
  const paintHeader = () => {
    ensure(rowH + 4);
    let y = getY();
    doc.setFillColor(232, 241, 240);
    doc.rect(margin, y - 11, width, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    headers.forEach((header, index) => {
      doc.text(header, margin + index * colW + 3, y);
    });
    setY(y + rowH);
  };
  paintHeader();
  rows.forEach((row, rowIndex) => {
    if (getY() + rowH > doc.internal.pageSize.getHeight() - 56) {
      doc.addPage();
      setY(48);
      paintHeader();
    }
    const y = getY();
    if (rowIndex % 2 === 1) {
      doc.setFillColor(247, 249, 250);
      doc.rect(margin, y - 11, width, rowH, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    row.forEach((cell, index) => {
      doc.text(cell, margin + index * colW + 3, y);
    });
    setY(y + rowH);
  });
}

function formatKwh(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} kWh`;
}

function formatKw(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} kW`;
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function trim(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
