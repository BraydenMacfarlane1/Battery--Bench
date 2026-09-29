import { describe, expect, it } from "vitest";
import {
  estimateBackup,
  formatBackupHeadline,
  formatBackupPowerLimit,
  type BackupEstimate,
} from "../src/dispatch/backup";
import { ALL_HOURS, HOURS_PER_YEAR } from "../src/dispatch/calendar";
import { sweepBatteries } from "../src/dispatch/rank";
import type { Battery, RateModel } from "../src/dispatch/types";

function zeros(): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(0);
}

function battery(overrides: Partial<Battery> = {}): Battery {
  return {
    id: "pack",
    name: "Pack",
    usable_capacity_kwh: 10,
    max_charge_rate_kw: 10,
    max_discharge_rate_kw: 10,
    cost_per_unit: 1000,
    round_trip_efficiency: 1,
    degradation_per_year: 0,
    ...overrides,
  };
}

function demandRate(): RateModel {
  return {
    name: "Synthetic demand",
    seasons: [],
    energy_periods: [],
    demand_components: [
      {
        name: "Facilities",
        is_facilities: true,
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        demand_rate_kw: 10,
      },
    ],
    fixed_monthly_charge: 0,
    export_credit_kwh: 0,
  };
}

/** 12 heavy hours at 5 kW, then 12 light hours at 1 kW, repeated all year. */
function dailyProfile(): number[] {
  const load = new Array<number>(HOURS_PER_YEAR);
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) load[hour] = hour % 24 < 12 ? 5 : 1;
  return load;
}

function packInput(load: number[], overrides: Partial<Parameters<typeof estimateBackup>[0]> = {}) {
  return estimateBackup({
    load_kwh: load,
    battery: battery(),
    quantity: 1,
    load_mode: "backup_loads",
    shape: "fixed_kw",
    critical_load_kw: 4,
    ...overrides,
  });
}

describe("backup duration", () => {
  it("reports one duration for a constant load the inverter can carry", () => {
    const estimate = estimateBackup({
      load_kwh: zeros(),
      battery: battery({ usable_capacity_kwh: 30, max_discharge_rate_kw: 30 }),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 10,
    });
    expect(estimate.hours_typical).toBeCloseTo(3, 6);
    expect(estimate.hours_conservative).toBeCloseTo(3, 6);
    expect(estimate.hours_min).toBeCloseTo(3, 6);
    expect(estimate.hours_max).toBeCloseTo(3, 6);
    expect(estimate.hours_at_average_load).toBeCloseTo(3, 6);
    expect(estimate.hours_at_peak_load).toBeCloseTo(3, 6);
    expect(estimate.cannot_carry_load).toBe(false);
    expect(formatBackupHeadline(estimate)).toBe("About 3.0 hours (conservative 3.0 hours)");
  });

  it("counts a partial hour and applies discharge efficiency", () => {
    const partial = estimateBackup({
      load_kwh: zeros(),
      battery: battery(),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 4,
    });
    expect(partial.hours_typical).toBeCloseTo(2.5, 6);

    const lossy = estimateBackup({
      load_kwh: zeros(),
      battery: battery({ usable_capacity_kwh: 100, round_trip_efficiency: 0.81, max_discharge_rate_kw: 50 }),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 9,
    });
    expect(lossy.deliverable_ac_kwh).toBeCloseTo(90, 6);
    expect(lossy.hours_typical).toBeCloseTo(10, 6);
  });

  it("stops at the discharge limit and reports the shortfall", () => {
    const estimate = estimateBackup({
      load_kwh: zeros(),
      battery: battery({ max_discharge_rate_kw: 30, usable_capacity_kwh: 30 }),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 100,
    });
    expect(estimate.hours_typical).toBe(0);
    expect(estimate.cannot_carry_load).toBe(true);
    expect(estimate.power_shortfall_kw).toBeCloseTo(70, 6);
    expect(estimate.hours_load_exceeds_power).toBe(HOURS_PER_YEAR);
    expect(estimate.hours_at_peak_load).toBe(0);
    expect(formatBackupPowerLimit(estimate)).toContain("70.0 kW");
    expect(formatBackupPowerLimit(estimate)).toContain("8,760");
  });

  it("treats a load equal to discharge power as covered", () => {
    const estimate = estimateBackup({
      load_kwh: zeros(),
      battery: battery({ usable_capacity_kwh: 20, max_discharge_rate_kw: 10 }),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 10,
    });
    expect(estimate.cannot_carry_load).toBe(false);
    expect(estimate.hours_typical).toBeCloseTo(2, 6);
  });

  it("scales with starting charge, the SOC window, and quantity", () => {
    const load = zeros();
    const half = estimateBackup({
      load_kwh: load,
      battery: battery({ usable_capacity_kwh: 20 }),
      quantity: 1,
      start_soc: 0.25,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 5,
    });
    expect(half.hours_typical).toBeCloseTo(1, 6);
    expect(half.start_soc).toBeCloseTo(0.25, 6);

    const windowed = estimateBackup({
      load_kwh: load,
      battery: battery({ usable_capacity_kwh: 20 }),
      quantity: 1,
      soc_min: 0.5,
      start_soc: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 5,
    });
    expect(windowed.deliverable_ac_kwh).toBeCloseTo(10, 6);
    expect(windowed.hours_typical).toBeCloseTo(2, 6);
    expect(windowed.start_soc).toBeCloseTo(1, 6);

    const clamped = estimateBackup({
      load_kwh: load,
      battery: battery({ usable_capacity_kwh: 20 }),
      quantity: 2,
      soc_max: 0.8,
      start_soc: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 8,
    });
    expect(clamped.start_soc).toBeCloseTo(0.8, 6);
    expect(clamped.deliverable_ac_kwh).toBeCloseTo(32, 6);
    expect(clamped.hours_typical).toBeCloseTo(4, 6);
  });

  it("caps the sliding run at 72 hours and leaves the average-load figure uncapped", () => {
    const estimate = estimateBackup({
      load_kwh: zeros(),
      battery: battery({ usable_capacity_kwh: 500, max_discharge_rate_kw: 50 }),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 1,
    });
    expect(estimate.hours_typical).toBe(72);
    expect(estimate.hours_max).toBe(72);
    expect(estimate.horizon_reached).toBe(true);
    expect(estimate.hours_at_average_load).toBeCloseTo(500, 6);
  });

  it("distributes durations across start hours, including the wrap at the end of the year", () => {
    const load = dailyProfile();
    const estimate = estimateBackup({
      load_kwh: load,
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
    });
    expect(estimate.hours_min).toBeCloseTo(2, 5);
    expect(estimate.hours_max).toBeCloseTo(10, 5);
    expect(estimate.hours_conservative).toBeCloseTo(2, 5);
    expect(estimate.hours_typical).toBeCloseTo(3.2, 5);
    expect(estimate.hours_at_average_load).toBeCloseTo(10 / 3, 5);
    expect(estimate.hours_at_peak_load).toBeCloseTo(2, 5);
    expect(estimate.cannot_carry_load).toBe(false);

    const withIdleSolar = estimateBackup({
      load_kwh: load,
      solar_kwh: zeros(),
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
      include_solar: true,
    });
    expect(closeEstimate(estimate, withIdleSolar)).toBe(true);
  });

  it("uses a percent of each hour or a fixed backup load", () => {
    const load = dailyProfile();
    const whole = estimateBackup({
      load_kwh: load,
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
    });
    const percent = estimateBackup({
      load_kwh: load,
      battery: battery(),
      quantity: 1,
      load_mode: "backup_loads",
      shape: "percent_of_load",
      critical_load_fraction: 0.5,
    });
    expect(percent.average_load_kw).toBeCloseTo(whole.average_load_kw / 2, 6);
    expect(percent.hours_at_average_load).toBeCloseTo(10 / 1.5, 5);
    expect(percent.hours_typical).toBeGreaterThan(whole.hours_typical);

    const fixed = packInput(load);
    expect(fixed.hours_min).toBeCloseTo(2.5, 5);
    expect(fixed.hours_max).toBeCloseTo(2.5, 5);
    expect(fixed.peak_load_kw).toBeCloseTo(4, 6);
  });

  it("credits solar serving the load and solar charging the battery", () => {
    const covered = estimateBackup({
      load_kwh: new Array<number>(HOURS_PER_YEAR).fill(10),
      solar_kwh: new Array<number>(HOURS_PER_YEAR).fill(10),
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
      include_solar: true,
    });
    expect(covered.hours_typical).toBe(72);
    expect(covered.horizon_reached).toBe(true);
    const dark = estimateBackup({
      load_kwh: new Array<number>(HOURS_PER_YEAR).fill(10),
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
    });
    expect(dark.hours_typical).toBeCloseTo(1, 6);

    const load = zeros();
    const solar = zeros();
    for (let day = 0; day < 365; day += 1) {
      load[day * 24] = 0;
      solar[day * 24] = 10;
      for (let hour = 1; hour < 24; hour += 1) load[day * 24 + hour] = 10;
    }
    const charged = estimateBackup({
      load_kwh: load,
      solar_kwh: solar,
      battery: battery(),
      quantity: 1,
      start_soc: 0,
      load_mode: "whole_building",
      include_solar: true,
    });
    expect(charged.hours_max).toBeCloseTo(2, 5);
    expect(charged.hours_min).toBeCloseTo(0, 5);
    expect(charged.hours_typical).toBeCloseTo(0, 5);
    const uncharged = estimateBackup({
      load_kwh: load,
      battery: battery(),
      quantity: 1,
      start_soc: 0,
      load_mode: "whole_building",
    });
    expect(uncharged.hours_max).toBeCloseTo(1, 5);
  });

  it("flags hours above the inverter even when some starts still have backup", () => {
    const estimate = estimateBackup({
      load_kwh: dailyProfile(),
      battery: battery({ max_discharge_rate_kw: 4 }),
      quantity: 1,
      load_mode: "whole_building",
    });
    expect(estimate.cannot_carry_load).toBe(true);
    expect(estimate.power_shortfall_kw).toBeCloseTo(1, 6);
    expect(estimate.hours_load_exceeds_power).toBe(12 * 365);
    expect(estimate.hours_min).toBe(0);
    expect(formatBackupPowerLimit(estimate)).toMatch(/cannot carry this load/i);
  });

  it("rejects a short series, a bad percent, and a bad starting charge", () => {
    expect(() =>
      estimateBackup({
        load_kwh: [1, 2, 3],
        battery: battery(),
        quantity: 1,
        load_mode: "whole_building",
      }),
    ).toThrow(/8,760/);
    expect(() =>
      estimateBackup({
        load_kwh: zeros(),
        battery: battery(),
        quantity: 1,
        load_mode: "backup_loads",
        shape: "percent_of_load",
        critical_load_fraction: 0,
      }),
    ).toThrow(/percent/i);
    expect(() =>
      estimateBackup({
        load_kwh: zeros(),
        battery: battery(),
        quantity: 1,
        load_mode: "whole_building",
        start_soc: 1.2,
      }),
    ).toThrow(/state of charge/i);
  });

  it("matches the ranking column for a fixed critical load and for the whole building", () => {
    const load = zeros();
    for (let day = 0; day < 365; day += 1) load[day * 24 + 18] = 30;
    const pack = battery({ usable_capacity_kwh: 30, max_discharge_rate_kw: 30, max_charge_rate_kw: 30 });
    const swept = sweepBatteries({
      load_kwh: load,
      rate: demandRate(),
      batteries: [pack],
      max_quantity: 1,
      strategy: "demand_peak_shave",
      critical_load_kw: 10,
    });
    const direct = estimateBackup({
      load_kwh: load,
      battery: pack,
      quantity: 1,
      soc_min: 0,
      soc_max: 1,
      load_mode: "backup_loads",
      shape: "fixed_kw",
      critical_load_kw: 10,
      start_soc: 1,
      include_solar: false,
    });
    expect(swept[0].backup_hours).toBeCloseTo(direct.hours_typical, 6);
    expect(swept[0].backup_hours).toBeCloseTo(3, 6);

    const building = sweepBatteries({
      load_kwh: dailyProfile(),
      rate: demandRate(),
      batteries: [battery()],
      max_quantity: 1,
      strategy: "solar_self_consumption",
      backup: { load_mode: "whole_building", start_soc: 1, include_solar: false },
    });
    const buildingDirect = estimateBackup({
      load_kwh: dailyProfile(),
      battery: battery(),
      quantity: 1,
      load_mode: "whole_building",
      start_soc: 1,
    });
    expect(building[0].backup_hours).toBeCloseTo(buildingDirect.hours_typical, 6);
    expect(building[0].backup_estimate?.hours_conservative).toBeCloseTo(buildingDirect.hours_conservative, 6);
  });
});

function closeEstimate(a: BackupEstimate, b: BackupEstimate): boolean {
  return (
    Math.abs(a.hours_min - b.hours_min) < 1e-4 &&
    Math.abs(a.hours_max - b.hours_max) < 1e-4 &&
    Math.abs(a.hours_typical - b.hours_typical) < 1e-4 &&
    Math.abs(a.hours_conservative - b.hours_conservative) < 1e-4
  );
}
