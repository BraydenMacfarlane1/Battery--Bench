import type { CandidateMetrics, RankContext, RankingMode } from "../../dispatch/rank";
import { quantityChoicesForBattery } from "../../dispatch/rank";
import { batteryMissesConstraint, constraintMissLabel, uniqueBatteries } from "./model";

export function BatteryOverride({
  ranked,
  swept,
  known,
  peakKw,
  mode,
  ctx,
  selected,
  pinned,
  projectIds,
  onBattery,
  onQuantity,
  onReset,
}: {
  ranked: readonly CandidateMetrics[];
  swept: readonly CandidateMetrics[];
  /** Sampled rows plus any quantity simulated for the current selection. */
  known: readonly CandidateMetrics[];
  peakKw: number;
  mode: RankingMode;
  ctx: RankContext;
  selected: CandidateMetrics;
  pinned: boolean;
  projectIds: readonly string[];
  onBattery: (batteryId: string) => void;
  onQuantity: (quantity: number) => void;
  onReset: () => void;
}) {
  const batteries = uniqueBatteries(swept);
  const nameCount = new Map<string, number>();
  const inProject = new Set(projectIds);
  for (const battery of batteries) nameCount.set(battery.name, (nameCount.get(battery.name) ?? 0) + 1);
  const quantities = quantityChoicesForBattery(selected.battery, peakKw, [
    selected.quantity,
    ...known.filter((row) => row.battery.id === selected.battery.id).map((row) => row.quantity),
  ]);
  return (
    <div className="override" data-testid="battery-override">
      <label>
        Battery
        <select value={selected.battery.id} onChange={(event) => onBattery(event.target.value)}>
          {batteries.map((battery) => {
            const base = (nameCount.get(battery.name) ?? 0) > 1 ? `${battery.name} (${battery.id})` : battery.name;
            const project = inProject.has(battery.id) ? " — in this project" : "";
            const misses = batteryMissesConstraint(ranked, battery.id, mode, ctx);
            return (
              <option key={battery.id} value={battery.id}>
                {misses ? `${base}${project} — misses ranking constraint` : `${base}${project}`}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Quantity
        <select
          data-testid="quantity-select"
          value={String(selected.quantity)}
          onChange={(event) => onQuantity(Number(event.target.value))}
        >
          {quantities.map((quantity) => {
            const row = known.find((entry) => entry.battery.id === selected.battery.id && entry.quantity === quantity);
            const misses = row ? constraintMissLabel(row, mode, ctx) : null;
            return (
              <option key={quantity} value={quantity}>
                {misses ? `${quantity} — misses ranking constraint` : String(quantity)}
              </option>
            );
          })}
        </select>
      </label>
      {pinned ? (
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Reset to best
        </button>
      ) : (
        <p className="meta">Showing the best for this mode.</p>
      )}
    </div>
  );
}
