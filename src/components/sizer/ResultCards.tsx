import {
  BACKUP_ASSUMPTIONS,
  formatBackupHeadline,
  formatBackupPowerLimit,
  type BackupEstimate,
  type BackupLoadMode,
  type BackupLoadShape,
} from "../../dispatch/backup";
import type { CandidateMetrics } from "../../dispatch/rank";
import type { SimulationResult } from "../../dispatch/types";
import { MONTH_SHORT, money, monthStamp, years } from "./format";
import { backupScenarioText, compareWithBest } from "./model";
import { DispatchChart } from "./HourlyCharts";

export function SelectionCard({
  selected,
  best,
  modeLabel,
  miss,
}: {
  selected: CandidateMetrics;
  best: CandidateMetrics;
  modeLabel: string;
  miss: string | null;
}) {
  const isBest = selected.battery.id === best.battery.id && selected.quantity === best.quantity;
  const self = selected.self_consumption_pct == null ? "—" : `${Math.round(selected.self_consumption_pct * 100)}%`;
  return (
    <div className="money" data-testid="top-pick">
      <p className="money-kicker" data-testid="selection-badge">
        {isBest ? `Best for ${modeLabel}` : "Selected battery"}
      </p>
      <p className="dollars" data-testid="selection-title">
        {selected.quantity} × {selected.battery.name}
      </p>
      <p className="rate-line">
        {money(selected.annual_savings_usd)} / yr · payback {years(selected.simple_payback_years)} · NPV {money(selected.npv_usd)}
      </p>
      <p className="rate-line">
        Peak cut {selected.peak_reduction_kw.toFixed(1)} kW · solar self-consumption {self} · {money(selected.installed_cost_usd)}{" "}
        installed
      </p>
      {isBest ? null : (
        <p className="rate-line" data-testid="selection-compare">
          {compareWithBest(selected, best, modeLabel)}
        </p>
      )}
      {miss ? (
        <p className="disclaimer" data-testid="constraint-note">
          {miss}
        </p>
      ) : null}
    </div>
  );
}

export function StatTiles({ selected }: { selected: CandidateMetrics }) {
  const self = selected.self_consumption_pct == null ? "—" : `${Math.round(selected.self_consumption_pct * 100)}%`;
  const tiles = [
    ["Annual savings", `${money(selected.annual_savings_usd)}`],
    ["Payback", years(selected.simple_payback_years)],
    ["NPV", money(selected.npv_usd)],
    ["Peak cut", `${selected.peak_reduction_kw.toFixed(1)} kW`],
    ["Self-consumption", self],
    ["Installed", money(selected.installed_cost_usd)],
  ];
  return (
    <dl className="stat-grid">
      {tiles.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BackupResult({
  estimate,
  backupMode,
  backupShape,
  backupPercent,
  criticalKw,
  outageSoc,
  outageSolar,
}: {
  estimate: BackupEstimate | null;
  backupMode: BackupLoadMode;
  backupShape: BackupLoadShape;
  backupPercent: string;
  criticalKw: string;
  outageSoc: string;
  outageSolar: boolean;
}) {
  if (!estimate) return null;
  const requested = Number(outageSoc) / 100;
  const clamped = Number.isFinite(requested) && Math.abs(requested - estimate.start_soc) > 0.001;
  const power = formatBackupPowerLimit(estimate);
  return (
    <section className="report-block" data-testid="backup-result">
      <h3>Backup duration</h3>
      <p className="backup-headline" data-testid="backup-headline">
        {formatBackupHeadline(estimate)}
      </p>
      <p className="meta">{backupScenarioText(backupMode, backupShape, backupPercent, criticalKw, estimate, outageSolar)}</p>
      {clamped ? (
        <p className="note">Starting charge is clamped to {Math.round(estimate.start_soc * 100)}% by the SOC window.</p>
      ) : null}
      {estimate.horizon_reached ? (
        <p className="note">At least one start hour is still going at the {estimate.horizon_hours}-hour cap.</p>
      ) : null}
      {power ? <p className="warn-line">{power}</p> : null}
      <p className="note">
        Grid-tied inverters shut down without islanding-capable equipment. Leave solar off unless the site can island.
      </p>
      <ul className="point-list">
        <li>
          <span>Average load</span>
          <span>{hoursOrEmpty(estimate.hours_at_average_load)}</span>
        </li>
        <li>
          <span>Peak-load hour</span>
          <span>{hoursOrEmpty(estimate.hours_at_peak_load)}</span>
        </li>
        <li>
          <span>Worst start</span>
          <span>{estimate.hours_min.toFixed(1)} h</span>
        </li>
        <li>
          <span>Typical start</span>
          <span>{estimate.hours_typical.toFixed(1)} h</span>
        </li>
        <li>
          <span>Conservative</span>
          <span>{estimate.hours_conservative.toFixed(1)} h</span>
        </li>
        <li>
          <span>Best start</span>
          <span>{estimate.hours_max.toFixed(1)} h</span>
        </li>
      </ul>
      <ul className="backup-limits">
        {BACKUP_ASSUMPTIONS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function MonthlyBills({ simulation }: { simulation: SimulationResult }) {
  return (
    <div className="table-wrap">
      <table data-testid="monthly-bills">
        <caption>Monthly bills, before and after the battery</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Baseline</th>
            <th>With battery</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody>
          {simulation.baseline.months.map((month, index) => {
            const withBattery = simulation.with_battery.months[index];
            return (
              <tr key={month.month}>
                <td>{MONTH_SHORT[index]}</td>
                <td>{money(month.total_usd)}</td>
                <td>{money(withBattery?.total_usd ?? 0)}</td>
                <td>{money(month.total_usd - (withBattery?.total_usd ?? 0))}</td>
              </tr>
            );
          })}
          <tr>
            <td>Year</td>
            <td>{money(simulation.baseline.total_usd)}</td>
            <td>{money(simulation.with_battery.total_usd)}</td>
            <td>{money(simulation.annual_savings_usd)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DispatchDay({
  load,
  solar,
  discharge,
  gridImport,
}: {
  load: readonly number[];
  solar: readonly number[];
  discharge: readonly number[];
  gridImport: readonly number[];
}) {
  let peakHour = 0;
  let peak = -Infinity;
  for (let hour = 0; hour < load.length; hour += 1) {
    if (load[hour] > peak) {
      peak = load[hour];
      peakHour = hour;
    }
  }
  const dayStart = peakHour - (peakHour % 24);
  const stamp = monthStamp(dayStart);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const slice = (series: readonly number[]) => hours.map((hour) => series[dayStart + hour] ?? 0);
  return (
    <div data-testid="dispatch-view">
      <h3>Peak-day dispatch</h3>
      <DispatchChart
        label={`Dispatch on the peak-load day, ${stamp.month} ${stamp.day}`}
        series={[
          { name: "Load", color: "#0e2a43", values: slice(load) },
          { name: "Solar", color: "#b45309", values: slice(solar) },
          { name: "Discharge", color: "#0f766e", values: slice(discharge) },
          { name: "Grid import", color: "#1d4e89", values: slice(gridImport) },
        ]}
      />
      <p className="meta">Hourly dispatch for the day that contains the highest building load. Grid import is after the battery.</p>
    </div>
  );
}

function hoursOrEmpty(hours: number | null): string {
  if (hours == null) return "No load";
  return `${hours.toFixed(1)} h`;
}
