import { useMemo, useState } from "react";
import { formatBackupHeadline } from "../../dispatch/backup";
import { MODEL_ASSUMPTIONS } from "../../dispatch/assumptions";
import { constraintMissLabel } from "../../dispatch/rank";
import { MONTH_SHORT, money, years } from "./format";
import { SavingsChart } from "./HourlyCharts";
import { BatteryOverride } from "./BatteryOverride";
import { BackupResult, DispatchDay, MonthlyBills, SelectionCard, StatTiles } from "./ResultCards";
import { useSizer } from "./context";
import { downloadBytes, downloadTextFile } from "../../report/download";
import { buildReportCsv } from "../../report/csv";
import type { SizingReport } from "../../report/types";

export function ResultsStep() {
  const sizer = useSizer();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const selected = sizer.selection?.selected ?? null;
  const report = useMemo(() => {
    if (!sizer.model.ok || !sizer.selection || !selected || !sizer.rankMode) return null;
    return buildReport(sizer, selected);
  }, [sizer, selected]);

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
      <StatTiles selected={selected} />
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
  return `${lead.join(" ")} ${sizer.checkWarnings.join(" ")} NPV is pre-tax and ignores incentives. Degradation is ${sizer.degradation}% per year, applied to the cash flows, not by re-simulating a worn battery.`;
}

function buildReport(
  sizer: ReturnType<typeof useSizer>,
  selected: NonNullable<ReturnType<typeof useSizer>["selection"]>["selected"],
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
      "Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.",
      caveatText(sizer, selected.warnings),
    ],
  };
}
