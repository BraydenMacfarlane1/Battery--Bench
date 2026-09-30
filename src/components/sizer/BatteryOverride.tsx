import type { CandidateMetrics, RankContext, RankingMode } from "../../dispatch/rank";
import { batteryMissesConstraint, constraintMissLabel, uniqueBatteries } from "./model";

export function BatteryOverride({
  ranked,
  swept,
  mode,
  ctx,
  selected,
  pinned,
  onBattery,
  onQuantity,
  onReset,
}: {
  ranked: readonly CandidateMetrics[];
  swept: readonly CandidateMetrics[];
  mode: RankingMode;
  ctx: RankContext;
  selected: CandidateMetrics;
  pinned: boolean;
  onBattery: (batteryId: string) => void;
  onQuantity: (quantity: number) => void;
  onReset: () => void;
}) {
  const batteries = uniqueBatteries(swept);
  const nameCount = new Map<string, number>();
  for (const battery of batteries) nameCount.set(battery.name, (nameCount.get(battery.name) ?? 0) + 1);
  const quantities = swept
    .filter((row) => row.battery.id === selected.battery.id)
    .map((row) => row.quantity)
    .sort((a, b) => a - b);
  return (
    <div className="override" data-testid="battery-override">
      <label>
        Battery
        <select value={selected.battery.id} onChange={(event) => onBattery(event.target.value)}>
          {batteries.map((battery) => {
            const base = (nameCount.get(battery.name) ?? 0) > 1 ? `${battery.name} (${battery.id})` : battery.name;
            const misses = batteryMissesConstraint(ranked, battery.id, mode, ctx);
            return (
              <option key={battery.id} value={battery.id}>
                {misses ? `${base} — misses ranking constraint` : base}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        Quantity
        <select value={String(selected.quantity)} onChange={(event) => onQuantity(Number(event.target.value))}>
          {quantities.map((quantity) => {
            const row = swept.find((entry) => entry.battery.id === selected.battery.id && entry.quantity === quantity);
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
