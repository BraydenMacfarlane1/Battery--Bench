import { useSizer } from "./context";

export function BackupStep() {
  const sizer = useSizer();
  return (
    <div className="step">
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
