import { recommendBackup } from "../../dispatch/backup";
import { HOURS_PER_YEAR } from "../../dispatch/calendar";
import { useSizer } from "./context";

export function BackupStep() {
  const sizer = useSizer();
  return (
    <div className="step">
      {sizer.sunStudy?.backupFromSunDaddy && sizer.sunStudy.backupPrefillLabel ? (
        <p className="chip" data-testid="backup-from-sun-daddy">
          {sizer.sunStudy.backupPrefillLabel} Edits stay in Battery Bench and are not written back.
        </p>
      ) : (
        <BackupRecommendation />
      )}
      <div className="segmented" role="group" aria-label="Outage load">
        <button
          type="button"
          aria-pressed={sizer.backupMode === "whole_building"}
          onClick={() => sizer.setBackupMode("whole_building")}
        >
          Whole building
        </button>
        <button
          type="button"
          aria-pressed={sizer.backupMode === "backup_loads"}
          onClick={() => sizer.setBackupMode("backup_loads")}
        >
          Backup loads
        </button>
      </div>
      {sizer.backupMode === "backup_loads" ? (
        <div className="segmented" role="group" aria-label="Backup load shape">
          <button
            type="button"
            aria-pressed={sizer.backupShape === "percent_of_load"}
            onClick={() => sizer.setBackupShape("percent_of_load")}
          >
            Percent of load
          </button>
          <button type="button" aria-pressed={sizer.backupShape === "fixed_kw"} onClick={() => sizer.setBackupShape("fixed_kw")}>
            Fixed kW
          </button>
        </div>
      ) : (
        <p className="meta">Whole building uses the full hourly load.</p>
      )}
      {sizer.backupMode === "backup_loads" ? (
        <div className="form-grid">
          {sizer.backupShape === "percent_of_load" ? (
            <label>
              Percent of building load
              <input value={sizer.backupPercent} onChange={(event) => sizer.setBackupPercent(event.target.value)} />
            </label>
          ) : (
            <label>
              Fixed critical load (kW)
              <input value={sizer.criticalKw} onChange={(event) => sizer.setCriticalKw(event.target.value)} />
            </label>
          )}
        </div>
      ) : null}
      <label>
        Outage starting charge (%)
        <input value={sizer.outageSoc} onChange={(event) => sizer.setOutageSoc(event.target.value)} />
      </label>
      <p className="meta">
        {sizer.backupMode === "whole_building"
          ? "The battery starts at this charge and carries the whole building until it is empty."
          : sizer.backupShape === "percent_of_load"
            ? "Backup loads use this percent of each hour of the building load."
            : "Backup loads use this fixed kW in every hour."}
      </p>
      <label className="check">
        <input type="checkbox" checked={sizer.outageSolar} onChange={(event) => sizer.setOutageSolar(event.target.checked)} />
        Include solar during outage (optimistic)
      </label>
      <p className="note">
        Grid-tied inverters shut down without islanding-capable equipment. Leave this off unless the site can island.
      </p>
      {!sizer.model.ok ? (
        <div className="state-card is-error" role="alert">
          <p className="state-title">Backup settings need a fix</p>
          <p>{sizer.model.error}</p>
        </div>
      ) : null}
    </div>
  );
}

function BackupRecommendation() {
  const sizer = useSizer();
  const selected = sizer.selection?.selected ?? null;
  if (!sizer.hasData || !selected) {
    return (
      <p className="meta" data-testid="backup-recommendation">
        Load a study and a battery to see backup hours at shares of the average building load.
      </p>
    );
  }
  const targets = [Number(sizer.backupTargetA), Number(sizer.backupTargetB)].filter((hours) => Number.isFinite(hours) && hours > 0);
  let recommendation;
  try {
    recommendation = recommendBackup({
      battery: selected.battery,
      quantity: selected.quantity,
      averageLoadKw: sizer.annualLoadKwh / HOURS_PER_YEAR,
      targetHours: targets,
    });
  } catch (error) {
    return <p className="warn-line">{error instanceof Error ? error.message : "Backup recommendation could not be calculated."}</p>;
  }
  return (
    <section data-testid="backup-recommendation">
      <h3>Backup recommendation</h3>
      <p className="meta">
        {selected.quantity} × {selected.battery.name}. Hours use usable kWh after the minimum reserve and continuous kW
        as the power limit. A kW limit means the load is above the power the pack can hold, so stored kWh is not the
        constraint.
      </p>
      <table className="pick-table">
        <caption>Hours at a share of average building load</caption>
        <thead>
          <tr>
            <th>Share of average load</th>
            <th>Hours</th>
            <th>Limit</th>
          </tr>
        </thead>
        <tbody>
          {recommendation.shares.map((share) => (
            <tr key={share.loadFraction}>
              <td>{Math.round(share.loadFraction * 100)}%</td>
              <td>{share.hours == null ? "—" : share.hours.toFixed(1)}</td>
              <td>{limitLabel(share.limitedBy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <label>
          First target (hours)
          <input value={sizer.backupTargetA} onChange={(event) => sizer.setBackupTargetA(event.target.value)} />
        </label>
        <label>
          Second target (hours)
          <input value={sizer.backupTargetB} onChange={(event) => sizer.setBackupTargetB(event.target.value)} />
        </label>
      </div>
      <ul className="meta">
        {recommendation.targets.map((target) => (
          <li key={target.targetHours}>
            {target.percentOfBuilding == null
              ? `${target.targetHours} h target: average load is zero.`
              : target.wholeBuildingMeetsTarget
                ? `${target.targetHours} h target: the whole building is covered${target.limitedBy === "kw" ? ", limited by kW" : ""}.`
                : `${target.targetHours} h target: back up ${target.percentOfBuilding.toFixed(0)}% of the building, limited by ${target.limitedBy === "kw" ? "kW" : "kWh"}.`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function limitLabel(limit: "kwh" | "kw" | null): string {
  if (limit === "kw") return "kW, not kWh";
  if (limit === "kwh") return "kWh";
  return "—";
}
