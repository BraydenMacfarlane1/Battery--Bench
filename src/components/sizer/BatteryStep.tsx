import { RANKING_MODES, BACKUP_DURATION, CHEAPEST_PEAK_TARGET } from "../../dispatch/rank";
import type { DispatchStrategy } from "../../dispatch/types";
import { BatteryOverride } from "./BatteryOverride";
import { useSizer } from "./context";

const GOAL_COPY: Record<string, string> = {
  max_annual_savings: "Highest first-year bill savings.",
  best_payback: "Shortest simple payback.",
  max_lifetime_npv: "Highest lifetime value.",
  max_self_consumption: "Keep the most solar on site.",
  cheapest_peak_reduction: "Cheapest stack that hits a peak cut.",
  backup_duration: "Cheapest stack that covers the backup hours.",
};

const STRATEGIES: { id: DispatchStrategy; label: string }[] = [
  { id: "combined", label: "Combined" },
  { id: "demand_peak_shave", label: "Demand peak shaving" },
  { id: "tou_arbitrage", label: "TOU arbitrage" },
  { id: "solar_self_consumption", label: "Solar self-consumption" },
];

export function BatteryStep() {
  const sizer = useSizer();
  const model = sizer.model;
  const selection = sizer.selection;
  const mode = sizer.rankMode;
  return (
    <div className="step">
      <p className="note" data-testid="catalog-notice">
        {sizer.catalogNotice}
      </p>
      <div className="goal-grid" role="radiogroup" aria-label="Ranking mode">
        {RANKING_MODES.map((mode) => {
          const selected = sizer.modeId === mode.id;
          return (
            <div key={mode.id} className={selected ? "goal-card is-selected" : "goal-card"}>
              <button type="button" role="radio" aria-checked={selected} onClick={() => sizer.setModeId(mode.id)}>
                <span className="goal-title">{mode.label}</span>
                <span className="goal-copy">{GOAL_COPY[mode.id] ?? mode.description}</span>
              </button>
              {selected && mode.id === CHEAPEST_PEAK_TARGET.id ? (
                <label>
                  Peak reduction target (kW)
                  <input value={sizer.peakTarget} onChange={(event) => sizer.setPeakTarget(event.target.value)} />
                </label>
              ) : null}
              {selected && mode.id === BACKUP_DURATION.id ? (
                <label>
                  Backup target (hours)
                  <input value={sizer.backupHours} onChange={(event) => sizer.setBackupHours(event.target.value)} />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      {sizer.rankMode ? <p className="note">{sizer.rankMode.description}</p> : null}
      {sizer.unmetPeak ? (
        <p className="note">Nothing in the list hits the peak-kW target. The best row is the closest reduction.</p>
      ) : null}
      {sizer.unmetBackup ? (
        <p className="note">Nothing in the list covers the backup-hour target. The best row is the longest backup.</p>
      ) : null}

      {!sizer.model.ok ? (
        <div className="state-card is-error" role="alert">
          <p className="state-title">These settings need a fix</p>
          <p>{sizer.model.error}</p>
        </div>
      ) : null}

      {model.ok && selection && mode ? (
        <details className="fold">
          <summary>Choose a specific battery</summary>
          <p className="meta">Leave this closed to keep the best battery for the goal. The results page can switch it too.</p>
          <BatteryOverride
            ranked={model.ranked}
            swept={model.swept}
            mode={mode}
            ctx={sizer.rankContext}
            selected={selection.selected}
            pinned={selection.pinned}
            projectIds={sizer.projectIds}
            onBattery={sizer.chooseBattery}
            onQuantity={sizer.chooseQuantity}
            onReset={sizer.resetOverride}
          />
        </details>
      ) : null}

      <details className="fold">
        <summary>Advanced assumptions</summary>
        <label>
          Strategy
          <select value={sizer.strategy} onChange={(event) => sizer.setStrategy(event.target.value as DispatchStrategy)}>
            {STRATEGIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Round-trip efficiency (%)
            <input value={sizer.rte} onChange={(event) => sizer.setRte(event.target.value)} />
          </label>
          <label>
            Degradation (% / yr)
            <input value={sizer.degradation} onChange={(event) => sizer.setDegradation(event.target.value)} />
          </label>
          <label>
            SOC min (%)
            <input value={sizer.socMin} onChange={(event) => sizer.setSocMin(event.target.value)} />
          </label>
          <label>
            SOC max (%)
            <input value={sizer.socMax} onChange={(event) => sizer.setSocMax(event.target.value)} />
          </label>
          <label>
            Discount rate (%)
            <input value={sizer.discount} onChange={(event) => sizer.setDiscount(event.target.value)} />
          </label>
          <label>
            Rate escalator (%)
            <input value={sizer.escalator} onChange={(event) => sizer.setEscalator(event.target.value)} />
          </label>
          <label>
            Analysis years
            <input value={sizer.analysisYears} onChange={(event) => sizer.setAnalysisYears(event.target.value)} />
          </label>
          <label>
            Max units
            <input value={sizer.maxQuantity} onChange={(event) => sizer.setMaxQuantity(event.target.value)} />
          </label>
        </div>
        <p className="meta">
          Defaults are planning assumptions: 90% round trip, 2% degradation, 6% discount, 2% escalator, 25 years. Max units
          is a ceiling. Each battery is swept only across quantities that can matter for this site&apos;s peak.
        </p>
      </details>
    </div>
  );
}
