import { BILLED_PEAK_SCALE_CAVEAT, HOURLY_DEMAND_CAVEAT } from "./assumptions";
import { HOURS_PER_YEAR, monthInSeason, type HourStamp } from "./calendar";
import type { AnnualBill, DemandComponent, EnergyPeriod, MonthBill, RateModel, SeasonDef } from "./types";

type Windowed = {
  season_ids?: readonly string[];
  months?: readonly number[];
  weekday_hours: readonly boolean[];
  weekend_hours: readonly boolean[];
};

export function assertRateModel(rate: RateModel): void {
  if (!rate || typeof rate !== "object") throw new Error("Rate must be an object.");
  if (!Array.isArray(rate.seasons)) throw new Error("Rate is missing seasons.");
  const seasonIds = new Set<string>();
  for (const season of rate.seasons) {
    assertMonthNumber(season.start_month, `Season ${season.id || "(unnamed)"} start_month`);
    assertMonthNumber(season.end_month, `Season ${season.id || "(unnamed)"} end_month`);
    if (!season.id) throw new Error("Every season needs an id.");
    if (seasonIds.has(season.id)) throw new Error(`Duplicate season id ${season.id}.`);
    seasonIds.add(season.id);
  }
  if (!Array.isArray(rate.energy_periods)) throw new Error("Rate is missing energy_periods.");
  if (!Array.isArray(rate.demand_components)) throw new Error("Rate is missing demand_components.");
  rate.energy_periods.forEach((period, index) => assertEnergyPeriod(period, index, seasonIds));
  rate.demand_components.forEach((component, index) => assertDemandComponent(component, index, seasonIds));
  assertMoney(rate.fixed_monthly_charge, "fixed_monthly_charge", true);
  assertMoney(rate.export_credit_kwh, "export_credit_kwh", false);
  if (rate.min_bill_usd != null) assertMoney(rate.min_bill_usd, "min_bill_usd", true);
  if (rate.tax_rate != null) {
    if (typeof rate.tax_rate !== "number" || !Number.isFinite(rate.tax_rate) || rate.tax_rate < 0 || rate.tax_rate > 1) {
      throw new Error("tax_rate must be a fraction from 0 to 1.");
    }
  }
}

function assertEnergyPeriod(period: EnergyPeriod, index: number, seasonIds: Set<string>): void {
  const label = `Energy period ${period?.name || index}`;
  if (!period || typeof period.name !== "string" || period.name.length === 0) {
    throw new Error(`${label} needs a name.`);
  }
  assertMask(period.weekday_hours, `${label} weekday_hours`);
  assertMask(period.weekend_hours, `${label} weekend_hours`);
  assertMoney(period.energy_rate_kwh, `${label} energy_rate_kwh`, false);
  if (period.export_rate_kwh != null) assertMoney(period.export_rate_kwh, `${label} export_rate_kwh`, false);
  assertMonths(period.months, label);
  assertSeasonRefs(period.season_ids, seasonIds, label);
}

function assertDemandComponent(component: DemandComponent, index: number, seasonIds: Set<string>): void {
  const label = `Demand component ${component?.name || index}`;
  if (!component || typeof component.name !== "string" || component.name.length === 0) {
    throw new Error(`${label} needs a name.`);
  }
  assertMask(component.weekday_hours, `${label} weekday_hours`);
  assertMask(component.weekend_hours, `${label} weekend_hours`);
  assertMoney(component.demand_rate_kw, `${label} demand_rate_kw`, true);
  if (typeof component.is_facilities !== "boolean") throw new Error(`${label} is_facilities must be true or false.`);
  assertMonths(component.months, label);
  assertSeasonRefs(component.season_ids, seasonIds, label);
}

function assertMask(mask: readonly boolean[], label: string): void {
  if (!Array.isArray(mask) || mask.length !== 24 || mask.some((bit) => typeof bit !== "boolean")) {
    throw new Error(`${label} must be 24 booleans.`);
  }
}

function assertMonths(months: readonly number[] | undefined, label: string): void {
  if (months == null) return;
  if (!Array.isArray(months)) throw new Error(`${label} months must be an array.`);
  for (const month of months) assertMonthNumber(month, label);
}

function assertMonthNumber(month: number, label: string): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`${label} must be a calendar month from 1 to 12.`);
  }
}

function assertSeasonRefs(ids: readonly string[] | undefined, known: Set<string>, label: string): void {
  if (ids == null) return;
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`${label} references unknown season ${id}.`);
  }
}

function assertMoney(value: number, label: string, nonNegative: boolean): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  if (nonNegative && value < 0) throw new Error(`${label} must be zero or positive.`);
}

export function windowCovers(window: Windowed, stamp: HourStamp, seasons: readonly SeasonDef[], ignoreHours: boolean): boolean {
  if (window.months && window.months.length > 0 && !window.months.includes(stamp.month)) return false;
  if (window.season_ids && window.season_ids.length > 0) {
    const selected = seasons.filter((season) => window.season_ids?.includes(season.id));
    if (!selected.some((season) => monthInSeason(stamp.month, season.start_month, season.end_month))) return false;
  }
  if (ignoreHours) return true;
  const mask = stamp.isWeekend ? window.weekend_hours : window.weekday_hours;
  return mask[stamp.hour] === true;
}

export type HourlyPrices = {
  importRate: number[];
  exportRate: number[];
  /** False when no energy period covers the hour. A real $0 price is still covered. */
  covered: boolean[];
  unpricedHours: number;
};

/** Import rates stack. Export uses period credits when any matching period sets one. */
export function hourlyPrices(rate: RateModel, calendar: readonly HourStamp[]): HourlyPrices {
  const importRate = new Array<number>(HOURS_PER_YEAR).fill(0);
  const exportRate = new Array<number>(HOURS_PER_YEAR).fill(0);
  const covered = new Array<boolean>(HOURS_PER_YEAR).fill(false);
  let unpricedHours = 0;
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const stamp = calendar[hour];
    let energy = 0;
    let exportCredit = 0;
    let sawExport = false;
    let matched = false;
    for (const period of rate.energy_periods) {
      if (!windowCovers(period, stamp, rate.seasons, false)) continue;
      matched = true;
      energy += period.energy_rate_kwh;
      if (period.export_rate_kwh != null) {
        sawExport = true;
        exportCredit += period.export_rate_kwh;
      }
    }
    importRate[hour] = energy;
    exportRate[hour] = sawExport ? exportCredit : rate.export_credit_kwh;
    covered[hour] = matched;
    if (!matched) unpricedHours += 1;
  }
  return { importRate, exportRate, covered, unpricedHours };
}

export function monthlyPeaks(values: ArrayLike<number>, calendar: readonly HourStamp[]): number[] {
  const peaks = new Array<number>(12).fill(0);
  for (let hour = 0; hour < values.length; hour += 1) {
    const month = calendar[hour].monthIndex;
    if (values[hour] > peaks[month]) peaks[month] = values[hour];
  }
  return peaks;
}

export function demandScaleByMonth(
  baselineImport: ArrayLike<number>,
  calendar: readonly HourStamp[],
  billedPeakKw: readonly (number | null)[] | undefined,
): { scales: number[]; warnings: string[]; usedCalibration: boolean } {
  const scales = new Array<number>(12).fill(1);
  if (billedPeakKw == null) return { scales, warnings: [], usedCalibration: false };
  if (billedPeakKw.length !== 12) throw new Error("billed_peak_kw must have 12 months (January–December).");
  const hourly = monthlyPeaks(baselineImport, calendar);
  const warnings: string[] = [];
  let used = false;
  for (let month = 0; month < 12; month += 1) {
    const billed = billedPeakKw[month];
    if (billed == null) continue;
    if (typeof billed !== "number" || !Number.isFinite(billed) || billed < 0) {
      throw new Error(`Billed peak for month ${month + 1} must be zero or positive.`);
    }
    used = true;
    if (hourly[month] <= 1e-9) {
      warnings.push(
        `Month ${month + 1}: billed peak is ${billed} kW but the hourly peak is 0, so that month was not scaled.`,
      );
      continue;
    }
    scales[month] = billed / hourly[month];
  }
  if (used) warnings.unshift(BILLED_PEAK_SCALE_CAVEAT);
  return { scales, warnings, usedCalibration: used };
}

export function priceYear(args: {
  rate: RateModel;
  calendar: readonly HourStamp[];
  gridImportKwh: ArrayLike<number>;
  gridExportKwh: ArrayLike<number>;
  importRate: ArrayLike<number>;
  exportRate: ArrayLike<number>;
  scales: readonly number[];
  unpricedHours: number;
  demandCaveat: "hourly" | "scaled" | "none";
}): AnnualBill & { warnings: string[] } {
  const { rate, calendar } = args;
  const months: MonthBill[] = [];
  const warnings: string[] = [];
  if (args.unpricedHours > 0) {
    let unpricedImport = 0;
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      if (args.importRate[hour] === 0 && args.gridImportKwh[hour] > 0) {
        const stamp = calendar[hour];
        const covered = rate.energy_periods.some((period) => windowCovers(period, stamp, rate.seasons, false));
        if (!covered) unpricedImport += args.gridImportKwh[hour];
      }
    }
    if (unpricedImport > 1e-6) {
      warnings.push("Some imported energy falls outside every energy period and is priced at $0/kWh.");
    }
  }
  if (args.demandCaveat === "hourly" && rate.demand_components.length > 0) warnings.push(HOURLY_DEMAND_CAVEAT);
  if (args.demandCaveat === "scaled") warnings.push(BILLED_PEAK_SCALE_CAVEAT);

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    let energy = 0;
    let exportCredit = 0;
    const windowPeak = new Array<number>(rate.demand_components.length).fill(0);
    const windowActive = new Array<boolean>(rate.demand_components.length).fill(false);
    for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
      const stamp = calendar[hour];
      if (stamp.monthIndex !== monthIndex) continue;
      energy += args.gridImportKwh[hour] * args.importRate[hour];
      exportCredit += args.gridExportKwh[hour] * args.exportRate[hour];
      for (let componentIndex = 0; componentIndex < rate.demand_components.length; componentIndex += 1) {
        const component = rate.demand_components[componentIndex];
        if (!windowCovers(component, stamp, rate.seasons, component.is_facilities)) continue;
        windowActive[componentIndex] = true;
        if (args.gridImportKwh[hour] > windowPeak[componentIndex]) {
          windowPeak[componentIndex] = args.gridImportKwh[hour];
        }
      }
    }
    const demandLines = [];
    let demand = 0;
    for (let componentIndex = 0; componentIndex < rate.demand_components.length; componentIndex += 1) {
      if (!windowActive[componentIndex]) continue;
      const component = rate.demand_components[componentIndex];
      const assessed = windowPeak[componentIndex] * args.scales[monthIndex];
      const usd = assessed * component.demand_rate_kw;
      demand += usd;
      demandLines.push({
        name: component.name,
        peak_kw: windowPeak[componentIndex],
        assessed_kw: assessed,
        rate_per_kw: component.demand_rate_kw,
        usd,
      });
    }
    const fixed = rate.fixed_monthly_charge;
    const preMin = energy + demand + fixed - exportCredit;
    let subtotal = preMin;
    let minBillApplied = false;
    if (rate.min_bill_usd != null && subtotal < rate.min_bill_usd) {
      subtotal = rate.min_bill_usd;
      minBillApplied = true;
    }
    const tax = subtotal > 0 ? subtotal * (rate.tax_rate ?? 0) : 0;
    months.push({
      month: monthIndex + 1,
      energy_usd: energy,
      export_credit_usd: exportCredit,
      demand_usd: demand,
      demand_lines: demandLines,
      fixed_usd: fixed,
      pre_min_usd: preMin,
      min_bill_applied: minBillApplied,
      tax_usd: tax,
      total_usd: subtotal + tax,
    });
  }

  const annual: AnnualBill = {
    months,
    total_usd: sumBy(months, (month) => month.total_usd),
    energy_usd: sumBy(months, (month) => month.energy_usd),
    export_credit_usd: sumBy(months, (month) => month.export_credit_usd),
    demand_usd: sumBy(months, (month) => month.demand_usd),
    fixed_usd: sumBy(months, (month) => month.fixed_usd),
    tax_usd: sumBy(months, (month) => month.tax_usd),
  };
  return { ...annual, warnings };
}

function sumBy(months: readonly MonthBill[], pick: (month: MonthBill) => number): number {
  let total = 0;
  for (const month of months) total += pick(month);
  return total;
}
