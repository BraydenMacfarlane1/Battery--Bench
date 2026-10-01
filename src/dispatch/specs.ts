import type { Battery } from "./types";

/**
 * Catalog specs that change the hourly model.
 *
 * Null or omitted specs leave today's behavior in place:
 * - usable kWh is the catalog usable capacity
 * - charge kW is max_charge_rate_kw and discharge kW is max_discharge_rate_kw
 * - backup power is max_discharge_rate_kw
 *
 * min_reserve_pct (0–100) is held back before the state-of-charge window.
 * Effective usable kWh = usable_capacity_kwh × (1 − min_reserve_pct / 100).
 * The SOC window is then a fraction of that reduced energy, so a reserve and
 * a raised SOC minimum both apply. A null or 0 reserve removes nothing.
 *
 * Hourly charge kW = continuous_kw when it is set, otherwise max_charge_rate_kw.
 * Hourly discharge kW = peak_kw, otherwise continuous_kw, otherwise max_discharge_rate_kw.
 * Backup power uses continuous_kw when it is set, otherwise max_discharge_rate_kw.
 * Peak kW is a short burst. The backup estimate does not treat it as power the pack can hold for an hour.
 */
export function reserveFraction(battery: Battery): number {
  const reserve = battery.min_reserve_pct;
  if (reserve == null || !Number.isFinite(reserve) || reserve <= 0) return 0;
  if (reserve >= 100) return 0.99;
  return reserve / 100;
}

export function effectiveUsableKwh(battery: Battery): number {
  return battery.usable_capacity_kwh * (1 - reserveFraction(battery));
}

export function chargePowerKw(battery: Battery): number {
  if (battery.continuous_kw != null && Number.isFinite(battery.continuous_kw) && battery.continuous_kw >= 0) {
    return battery.continuous_kw;
  }
  return battery.max_charge_rate_kw;
}

export function dischargePowerKw(battery: Battery): number {
  if (battery.peak_kw != null && Number.isFinite(battery.peak_kw) && battery.peak_kw >= 0) return battery.peak_kw;
  if (battery.continuous_kw != null && Number.isFinite(battery.continuous_kw) && battery.continuous_kw >= 0) {
    return battery.continuous_kw;
  }
  return battery.max_discharge_rate_kw;
}

/** Sustained kW for an outage. Peak kW is not used here. */
export function backupPowerKw(battery: Battery): number {
  if (battery.continuous_kw != null && Number.isFinite(battery.continuous_kw) && battery.continuous_kw >= 0) {
    return battery.continuous_kw;
  }
  return battery.max_discharge_rate_kw;
}

export function efficiencyLabel(battery: Battery): string {
  const fraction = battery.round_trip_efficiency ?? 0.9;
  const pct = formatPct(fraction * 100);
  if (battery.efficiency_source === "spec") return `${pct}% from the battery spec`;
  return `${pct}% assumption (battery spec not set)`;
}

export function degradationLabel(battery: Battery): string {
  const fraction = battery.degradation_per_year ?? 0.02;
  const pct = formatPct(fraction * 100);
  if (battery.degradation_source === "spec") return `${pct}% per year from the battery spec`;
  return `${pct}% per year assumption (battery spec not set)`;
}

export function powerLimitLabel(battery: Battery): string | null {
  const parts: string[] = [];
  if (battery.continuous_kw != null) parts.push(`continuous ${formatPct(battery.continuous_kw)} kW`);
  if (battery.peak_kw != null) parts.push(`peak ${formatPct(battery.peak_kw)} kW`);
  if (parts.length === 0) return null;
  return `Power limits use the spec (${parts.join(", ")}).`;
}

function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
