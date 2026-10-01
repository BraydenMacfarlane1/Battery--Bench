import { useMemo, useState } from "react";
import { formatBackupHeadline, recommendBackup } from "../../dispatch/backup";
import { MODEL_ASSUMPTIONS } from "../../dispatch/assumptions";
import { degradationOf } from "../../dispatch/economics";
import { incentiveOutcome } from "../../dispatch/incentives";
import { constraintMissLabel } from "../../dispatch/rank";
import { degradationLabel, efficiencyLabel } from "../../dispatch/specs";
import { HOURS_PER_YEAR } from "../../dispatch/calendar";
import { MONTH_SHORT, money, years } from "./format";
import { SavingsChart } from "./HourlyCharts";
import { BatteryOverride } from "./BatteryOverride";
import { DataQualityPanel, qualityView } from "./DataQualityPanel";
import { BackupResult, DispatchDay, IncentiveColumns, MonthlyBills, SelectionCard, StatTiles, SunDaddyResultCard } from "./ResultCards";
import { useSizer } from "./context";
import { downloadBytes, downloadTextFile } from "../../report/download";
import { buildReportCsv } from "../../report/csv";
import type { IncentiveOutcome } from "../../dispatch/incentives";
import type { SizingReport } from "../../report/types";

export function ResultsStep() {
  const sizer = useSizer();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const selected = sizer.selection?.selected ?? null;
  const incentives = useMemo(() => {
    if (!sizer.model.ok || !selected) return null;
    try {
      return incentiveOutcome({
        installedCostUsd: selected.installed_cost_usd,
        annualSavingsUsd: selected.annual_savings_usd,
        degradationPerYear: degradationOf(selected.battery),
        rateEscalator: sizer.model.sim.rate_escalator,
        discountRate: sizer.model.sim.discount_rate,
        analysisYears: sizer.model.sim.analysis_years,
        finance: sizer.sunStudy?.finance ?? null,
        batteryId: selected.battery.id,
      });
    } catch {
      return null;
    }
  }, [sizer.model, sizer.sunStudy, selected]);
  const report = useMemo(() => {
    if (!sizer.model.ok || !sizer.selection || !selected || !sizer.rankMode) return null;
    return buildReport(sizer, selected, incentives);
  }, [sizer, selected, incentives]);

  if (!sizer.model.ok || !sizer.selection || !selected || !sizer.rankMode) {
    return (
      <div className="state-card is-error" role="alert">
        <p className="state-title">No ranking yet</p>
        <p>{sizer.model.ok ? "Add a battery to rank." : sizer.model.error}</p>
      </div>
    );
  }

  const mode = sizer.rankMode;
  const picked = sizer.selection;

  async function downloadPdf() {
    if (!report) return;
    setExporting(true);
    setExportError(null);
    try {
      const { buildReportPdf } = await import("../../report/pdf");
      const bytes = buildReportPdf(report);
      downloadBytes("battery-bench-report.pdf", bytes, "application/pdf");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not build the PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="step results-step">
      {sizer.source === "example" ? (
        <p className="note" data-testid="example-note">
          {sizer.rateName} · 8,760 load hours · {sizer.annualSolarKwh > 0 ? "solar attached" : "no solar"}. Round-number
          example prices are not a utility tariff.
        </p>
      ) : (
        <p className="note">
          {sizer.meta.customerName} · {sizer.meta.projectName}
        </p>
      )}
      <p className="meta">
        Goal · <span data-testid="active-mode">{mode.label}</span>
      </p>
      <SelectionCard
        selected={selected}
        best={picked.top}
        modeLabel={mode.label}
        miss={constraintMissLabel(selected, mode, sizer.rankContext)}
      />
      <p className="meta" data-testid="spec-labels">
        Round trip {efficiencyLabel(selected.battery)}. Degradation {degradationLabel(selected.battery)}.
      </p>
      <StatTiles selected={selected} />
      <IncentiveColumns plainPayback={selected.simple_payback_years} plainNpv={selected.npv_usd} outcome={incentives} />
      <DataQualityPanel />
      <SunDaddyResultCard results={sizer.sunStudy?.results ?? []} />
      <p className="note" data-testid="internal-export-note">
        PDF and CSV are internal. They are not for customer distribution, and they are the only reports this tool builds.
      </p>
      <div className="export-row">
        <button type="button" className="btn btn-primary" onClick={() => void downloadPdf()} disabled={exporting || !report}>
          {exporting ? "Preparing PDF…" : "Download PDF report"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!report}
          onClick={() => {
            if (!report) return;
            downloadTextFile("battery-bench-report.csv", buildReportCsv(report), "text/csv;charset=utf-8");
          }}
        >
          Download CSV
        </button>
      </div>
      {exportError ? (
        <p className="warn-line" role="alert">
          {exportError}
        </p>
      ) : null}
      {sizer.unmetPeak ? (
        <p className="note">Nothing in the list hits the peak-kW target. The best row is the closest reduction.</p>
      ) : null}
      {sizer.unmetBackup ? (
        <p className="note">Nothing in the list covers the backup-hour target. The best row is the longest backup.</p>
      ) : null}
      <BatteryOverride
        ranked={sizer.model.ranked}
        swept={sizer.model.swept}
        known={sizer.comparison}
        peakKw={sizer.peakKw}
        mode={mode}
        ctx={sizer.rankContext}
        selected={selected}
        pinned={picked.pinned}
        projectIds={sizer.projectIds}
        onBattery={sizer.chooseBattery}
        onQuantity={sizer.chooseQuantity}
        onReset={sizer.resetOverride}
      />
      <div className="table-wrap">
        <table data-testid="comparison-table" className="pick-table">
          <caption>
            Comparison
            {sizer.modeId === "backup_duration"
              ? ". Backup hours are the typical outage duration, the same figure as the detail view."
              : ""}
          </caption>
          <thead>
            <tr>
              <th>Battery</th>
              <th>Qty</th>
              <th>Savings</th>
              <th>Payback</th>
              <th>NPV</th>
              <th>Peak cut</th>
              <th>Self-use</th>
              <th>Cycles</th>
              <th data-testid="backup-column">Backup</th>
            </tr>
          </thead>
          <tbody>
            {sizer.comparison.map((row) => {
              const isPicked = row.battery.id === selected.battery.id && row.quantity === selected.quantity;
              return (
                <tr
                  key={`${row.battery.id}-${row.quantity}`}
                  className={isPicked ? "is-selected" : undefined}
                  aria-selected={isPicked}
                  tabIndex={0}
                  onClick={() => sizer.selectStack(row.battery.id, row.quantity)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      sizer.selectStack(row.battery.id, row.quantity);
                    }
                  }}
                >
                  <td>{row.battery.name}</td>
                  <td>{row.quantity}</td>
                  <td>{money(row.annual_savings_usd)}</td>
                  <td>{years(row.simple_payback_years)}</td>
                  <td>{money(row.npv_usd)}</td>
                  <td>{row.peak_reduction_kw.toFixed(1)} kW</td>
                  <td>{row.self_consumption_pct == null ? "—" : `${Math.round(row.self_consumption_pct * 100)}%`}</td>
                  <td>{row.equivalent_cycles.toFixed(0)}</td>
                  <td>{row.backup_hours == null ? "—" : `${row.backup_hours.toFixed(1)} h`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sizer.detail ? <MonthlyBills simulation={sizer.detail} /> : null}
      {sizer.detail?.hourly ? (
        <DispatchDay
          load={sizer.model.sim.load_kwh}
          solar={sizer.model.sim.solar_kwh}
          discharge={sizer.detail.hourly.discharge_ac_kwh}
          gridImport={sizer.detail.hourly.grid_import_kwh}
        />
      ) : null}
      <h3>Savings versus size</h3>
      <SavingsChart series={sizer.chartSeries} />
      <BackupResult
        estimate={selected.backup_estimate ?? null}
        backupMode={sizer.backupMode}
        backupShape={sizer.backupShape}
        backupPercent={sizer.backupPercent}
        criticalKw={sizer.criticalKw}
        outageSoc={sizer.outageSoc}
        outageSolar={sizer.outageSolar}
      />
      <div className="hint" data-testid="sizer-caveat">
        {caveatText(sizer, selected.warnings)}
      </div>
      <details className="assumptions">
        <summary>Model assumptions</summary>
        <ul>
          {MODEL_ASSUMPTIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function caveatText(
  sizer: { checkWarnings: string[]; degradation: string },
  warnings: string[],
): string {
  const lead = (warnings.length > 0 ? warnings : ["Demand uses the hourly peak unless billed peaks are set."]).slice(0, 2);
  return `${lead.join(" ")} ${sizer.checkWarnings.join(" ")} The catalog-price NPV is pre-tax and ignores incentives. The incentive column is separate and labels anything it does not model. Degradation on a battery with no catalog spec follows the advanced-assumptions field.`;
}

function buildReport(
  sizer: ReturnType<typeof useSizer>,
  selected: NonNullable<ReturnType<typeof useSizer>["selection"]>["selected"],
  incentives: IncentiveOutcome | null,
): SizingReport {
  const months = sizer.detail
    ? [
        ...sizer.detail.baseline.months.map((month, index) => {
          const withBattery = sizer.detail?.with_battery.months[index];
          return {
            month: MONTH_SHORT[index] ?? String(month.month),
            baselineUsd: month.total_usd,
            withBatteryUsd: withBattery?.total_usd ?? 0,
            savingsUsd: month.total_usd - (withBattery?.total_usd ?? 0),
          };
        }),
        {
          month: "Year",
          baselineUsd: sizer.detail.baseline.total_usd,
          withBatteryUsd: sizer.detail.with_battery.total_usd,
          savingsUsd: sizer.detail.annual_savings_usd,
        },
      ]
    : [];
  const ranked = sizer.comparison;
  const quality = sizer.source === "sun" ? qualityView(sizer.sunStudy, sizer.tariffWarnings, sizer.loadSourceBadge) : null;
  return {
    generatedAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    customerName: sizer.meta.customerName,
    projectName: sizer.meta.projectName,
    utilityName: sizer.meta.utility ?? "Not listed",
    rateName: sizer.rateName,
    annualLoadKwh: sizer.annualLoadKwh,
    peakKw: sizer.peakKw,
    annualSolarKwh: sizer.annualSolarKwh,
    batteryName: selected.battery.name,
    quantity: selected.quantity,
    goal: sizer.rankMode?.label ?? "Max annual savings",
    annualSavingsUsd: selected.annual_savings_usd,
    paybackYears: selected.simple_payback_years,
    npvUsd: selected.npv_usd,
    peakReductionKw: selected.peak_reduction_kw,
    selfConsumptionPct: selected.self_consumption_pct,
    installedCostUsd: selected.installed_cost_usd,
    backupHeadline: selected.backup_estimate ? formatBackupHeadline(selected.backup_estimate) : null,
    options: ranked.map((row) => ({
      battery: row.battery.name,
      quantity: row.quantity,
      annualSavingsUsd: row.annual_savings_usd,
      paybackYears: row.simple_payback_years,
      npvUsd: row.npv_usd,
      peakReductionKw: row.peak_reduction_kw,
      selfConsumptionPct: row.self_consumption_pct,
      cycles: row.equivalent_cycles,
      backupHours: row.backup_hours,
    })),
    months,
    assumptions: [...MODEL_ASSUMPTIONS],
    limitations: [
      "INTERNAL - not for customer distribution.",
      "Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.",
      caveatText(sizer, selected.warnings),
    ],
    dataQuality: quality
      ? {
          hourlySource: quality.hourlyLabel,
          peaksSource: quality.peaksLabel,
          billCheck: quality.billDetail ? `${quality.billTitle}. ${quality.billDetail}` : quality.billTitle,
          confidence: quality.confidence,
          rateVerification: quality.rateText,
          nemNote: quality.nemNote,
        }
      : null,
    incentives: incentives
      ? {
          paybackYears: incentives.paybackYears,
          npvUsd: incentives.npvUsd,
          notes: [...incentives.notes, ...incentives.notModeled.map((line) => `Not modeled: ${line}`)],
        }
      : null,
    backupRecommendation: backupRecommendationLines(sizer, selected),
    efficiencyLabel: efficiencyLabel(selected.battery),
    degradationLabel: degradationLabel(selected.battery),
  };
}

function backupRecommendationLines(
  sizer: ReturnType<typeof useSizer>,
  selected: NonNullable<ReturnType<typeof useSizer>["selection"]>["selected"],
): string[] {
  const lines: string[] = [];
  if (sizer.sunStudy?.backupPrefillLabel) lines.push(sizer.sunStudy.backupPrefillLabel);
  if (!sizer.hasData) return lines;
  try {
    const targets = [Number(sizer.backupTargetA), Number(sizer.backupTargetB)].filter((hours) => Number.isFinite(hours) && hours > 0);
    const recommendation = recommendBackup({
      battery: selected.battery,
      quantity: selected.quantity,
      averageLoadKw: sizer.annualLoadKwh / HOURS_PER_YEAR,
      targetHours: targets,
    });
    for (const share of recommendation.shares) {
      const hours = share.hours == null ? "n/a" : `${share.hours.toFixed(1)} h`;
      const limit = share.limitedBy === "kw" ? "limited by kW" : share.limitedBy === "kwh" ? "limited by kWh" : "";
      lines.push(`${Math.round(share.loadFraction * 100)}% of average load: ${hours}${limit ? ` (${limit})` : ""}`);
    }
    for (const target of recommendation.targets) {
      if (target.percentOfBuilding == null) lines.push(`${target.targetHours} h target: average load is zero.`);
      else if (target.wholeBuildingMeetsTarget) lines.push(`${target.targetHours} h target: whole building is covered.`);
      else lines.push(`${target.targetHours} h target: ${target.percentOfBuilding.toFixed(0)}% of the building, limited by ${target.limitedBy === "kw" ? "kW" : "kWh"}.`);
    }
  } catch (error) {
    lines.push(error instanceof Error ? error.message : "Backup recommendation could not be calculated.");
  }
  return lines;
}
