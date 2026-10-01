import { DEFAULT_DEGRADATION_PER_YEAR, DEFAULT_ROUND_TRIP_EFFICIENCY } from "./assumptions";
import { chargePowerKw, dischargePowerKw, effectiveUsableKwh } from "./specs";
import {
  assertRateModel,
  demandScaleByMonth,
  hourlyPrices,
  monthlyPeaks,
  priceYear,
} from "./bill";
import { HOURS_PER_YEAR, buildCalendar, monthSpans, type MonthSpan } from "./calendar";
import type {
  Battery,
  DispatchStrategy,
  HourlyDispatch,
  SimulationInput,
  SimulationResult,
} from "./types";

export type Fleet = {
  usableKwh: number;
  maxCharge: number;
  maxDischarge: number;
  eta: number;
  socMin: number;
  socMax: number;
};

type TouSignals = {
  cheapest: Uint8Array;
  profitable: Uint8Array;
  futureTouAc: Float64Array;
};

type Lookahead = {
  reserveSoc: Float64Array;
  futureChargeAc: Float64Array;
};

const TOLERANCE_KW = 1e-4;

export function resolveRoundTrip(battery: Battery): number {
  return battery.round_trip_efficiency ?? DEFAULT_ROUND_TRIP_EFFICIENCY;
}

export function resolveDegradation(battery: Battery): number {
  return battery.degradation_per_year ?? DEFAULT_DEGRADATION_PER_YEAR;
}

export function fleetOf(battery: Battery, quantity: number, socMinFrac: number, socMaxFrac: number): Fleet {
  const usableKwh = effectiveUsableKwh(battery) * quantity;
  const rte = resolveRoundTrip(battery);
  return {
    usableKwh,
    maxCharge: chargePowerKw(battery) * quantity,
    maxDischarge: dischargePowerKw(battery) * quantity,
    eta: Math.sqrt(rte),
    socMin: usableKwh * socMinFrac,
    socMax: usableKwh * socMaxFrac,
  };
}

export function simulateDispatch(input: SimulationInput): SimulationResult {
  const calendar = buildCalendar(input.start_weekday ?? 1);
  const load = readSeries(input.load_kwh, "load_kwh");
  const solar = input.solar_kwh == null ? new Float64Array(HOURS_PER_YEAR) : readSeries(input.solar_kwh, "solar_kwh");
  assertRateModel(input.rate);
  const battery = input.battery;
  if (!battery || typeof battery.id !== "string" || battery.id.length === 0) throw new Error("Battery needs an id.");
  if (typeof battery.name !== "string" || battery.name.length === 0) throw new Error("Battery needs a name.");
  if (!(battery.usable_capacity_kwh > 0)) throw new Error("usable_capacity_kwh must be greater than zero.");
  if (!(battery.max_charge_rate_kw >= 0)) throw new Error("max_charge_rate_kw must be zero or positive.");
  if (!(battery.max_discharge_rate_kw >= 0)) throw new Error("max_discharge_rate_kw must be zero or positive.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error("quantity must be an integer of 1 or more.");
  const rte = resolveRoundTrip(battery);
  if (!(rte > 0 && rte <= 1)) throw new Error("round_trip_efficiency must be greater than 0 and at most 1.");
  const degradation = resolveDegradation(battery);
  if (!(degradation >= 0 && degradation < 1)) {
    throw new Error("degradation_per_year must be from 0 up to, but not including, 1.");
  }
  const socMinFrac = input.soc_min ?? 0;
  const socMaxFrac = input.soc_max ?? 1;
  if (!(socMinFrac >= 0 && socMaxFrac <= 1 && socMaxFrac > socMinFrac)) {
    throw new Error("SOC window must satisfy 0 ≤ soc_min < soc_max ≤ 1.");
  }
  const strategy = input.strategy;
  if (
    strategy !== "demand_peak_shave" &&
    strategy !== "tou_arbitrage" &&
    strategy !== "solar_self_consumption" &&
    strategy !== "combined"
  ) {
    throw new Error(`Unknown dispatch strategy ${String(strategy)}.`);
  }

  const fleet = fleetOf(battery, input.quantity, socMinFrac, socMaxFrac);
  const deficit = new Float64Array(HOURS_PER_YEAR);
  const excess = new Float64Array(HOURS_PER_YEAR);
  const baseImport = new Float64Array(HOURS_PER_YEAR);
  const baseExport = new Float64Array(HOURS_PER_YEAR);
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const net = load[hour] - solar[hour];
    deficit[hour] = net > 0 ? net : 0;
    excess[hour] = net < 0 ? -net : 0;
    baseImport[hour] = deficit[hour];
    baseExport[hour] = excess[hour];
  }

  const prices = hourlyPrices(input.rate, calendar);
  const tou = buildTouSignals(prices.importRate, prices.covered, deficit, fleet);
  const spans = monthSpans();
  const managesDemand = strategy === "demand_peak_shave" || strategy === "combined";
  const thresholds: Array<number | null> = new Array(12).fill(null);
  if (managesDemand) {
    for (let month = 0; month < 12; month += 1) {
      thresholds[month] = minimumThreshold(spans[month], fleet, deficit, excess);
    }
  }

  const charge = new Float64Array(HOURS_PER_YEAR);
  const discharge = new Float64Array(HOURS_PER_YEAR);
  const gridImport = new Float64Array(HOURS_PER_YEAR);
  const gridExport = new Float64Array(HOURS_PER_YEAR);
  const socEnd = new Float64Array(HOURS_PER_YEAR);
  let soc = fleet.socMin;
  for (let month = 0; month < 12; month += 1) {
    const span = spans[month];
    const cap = thresholds[month];
    const look = cap == null ? null : buildLookahead(span, cap, fleet, deficit, excess);
    for (let hour = span.start; hour < span.end; hour += 1) {
      const step = decideHour({
        soc,
        fleet,
        load: load[hour],
        solar: solar[hour],
        strategy,
        thresholdKw: cap,
        reserveSoc: look ? look.reserveSoc[hour] : fleet.socMin,
        futureChargeAc: look ? look.futureChargeAc[hour] : 0,
        futureTouAc: tou.futureTouAc[hour],
        cheapest: tou.cheapest[hour] === 1,
        profitableDischarge: tou.profitable[hour] === 1,
      });
      soc = step.soc;
      charge[hour] = step.chargeAc;
      discharge[hour] = step.dischargeAc;
      const net = load[hour] - solar[hour] + step.chargeAc - step.dischargeAc;
      gridImport[hour] = net > 0 ? net : 0;
      gridExport[hour] = net < 0 ? -net : 0;
      socEnd[hour] = soc;
    }
  }

  const calibration = demandScaleByMonth(baseImport, calendar, input.billed_peak_kw);
  const caveat = calibration.usedCalibration ? "scaled" : input.rate.demand_components.length > 0 ? "hourly" : "none";
  const baselinePriced = priceYear({
    rate: input.rate,
    calendar,
    gridImportKwh: baseImport,
    gridExportKwh: baseExport,
    importRate: prices.importRate,
    exportRate: prices.exportRate,
    scales: calibration.scales,
    unpricedHours: prices.unpricedHours,
    demandCaveat: caveat,
  });
  const batteryPriced = priceYear({
    rate: input.rate,
    calendar,
    gridImportKwh: gridImport,
    gridExportKwh: gridExport,
    importRate: prices.importRate,
    exportRate: prices.exportRate,
    scales: calibration.scales,
    unpricedHours: prices.unpricedHours,
    demandCaveat: "none",
  });

  const warnings = dedupe([...calibration.warnings, ...baselinePriced.warnings, ...batteryPriced.warnings]);
  const baseline = billWithoutWarnings(baselinePriced);
  const withBattery = billWithoutWarnings(batteryPriced);
  const includeHourly = input.include_hourly !== false;
  const hourly: HourlyDispatch | undefined = includeHourly
    ? {
        charge_ac_kwh: Array.from(charge),
        discharge_ac_kwh: Array.from(discharge),
        grid_import_kwh: Array.from(gridImport),
        grid_export_kwh: Array.from(gridExport),
        soc_end_kwh: Array.from(socEnd),
      }
    : undefined;

  return {
    battery_id: battery.id,
    quantity: input.quantity,
    strategy,
    annual_savings_usd: baseline.total_usd - withBattery.total_usd,
    baseline,
    with_battery: withBattery,
    monthly_peak_kw: {
      baseline: monthlyPeaks(baseImport, calendar),
      with_battery: monthlyPeaks(gridImport, calendar),
    },
    demand_threshold_kw: thresholds,
    totals: {
      load_kwh: sum(load),
      solar_kwh: sum(solar),
      charge_ac_kwh: sum(charge),
      discharge_ac_kwh: sum(discharge),
      grid_import_kwh: sum(gridImport),
      grid_export_kwh: sum(gridExport),
      soc_start_kwh: fleet.socMin,
      soc_end_kwh: soc,
    },
    hourly,
    warnings,
  };
}

type DecideInput = {
  soc: number;
  fleet: Fleet;
  load: number;
  solar: number;
  strategy: DispatchStrategy;
  thresholdKw: number | null;
  reserveSoc: number;
  futureChargeAc: number;
  futureTouAc: number;
  cheapest: boolean;
  profitableDischarge: boolean;
};

export function decideHour(input: DecideInput): { soc: number; chargeAc: number; dischargeAc: number } {
  const { fleet } = input;
  const eta = fleet.eta;
  const excess = Math.max(0, input.solar - input.load);
  const deficit = Math.max(0, input.load - input.solar);
  let soc = input.soc;
  let charge = 0;
  let discharge = 0;

  const takeCharge = (requested: number): void => {
    if (!(requested > 0)) return;
    const powerLeft = fleet.maxCharge - charge;
    const roomAc = (fleet.socMax - soc) / eta;
    const taken = Math.min(requested, powerLeft, Math.max(0, roomAc));
    if (!(taken > 1e-12)) return;
    charge += taken;
    soc += taken * eta;
  };

  const takeDischarge = (requested: number): void => {
    if (!(requested > 0)) return;
    const powerLeft = fleet.maxDischarge - discharge;
    const availAc = (soc - fleet.socMin) * eta;
    const taken = Math.min(requested, powerLeft, Math.max(0, availAc));
    if (!(taken > 1e-12)) return;
    discharge += taken;
    soc -= taken / eta;
  };

  if (excess > 0) takeCharge(excess);

  const cap = input.thresholdKw;
  if (cap != null && deficit > cap) {
    takeDischarge(deficit - cap);
    if (input.strategy === "combined" && input.profitableDischarge) {
      const spareAc = Math.max(0, soc - input.reserveSoc) * eta;
      takeDischarge(Math.min(spareAc, Math.max(0, deficit - discharge)));
    }
  } else if (deficit > 0) {
    if (input.strategy === "solar_self_consumption") {
      takeDischarge(deficit);
    } else if ((input.strategy === "tou_arbitrage" || input.strategy === "combined") && input.profitableDischarge) {
      if (input.strategy === "combined") {
        const spareAc = Math.max(0, soc - input.reserveSoc) * eta;
        takeDischarge(Math.min(deficit, spareAc));
      } else {
        takeDischarge(deficit);
      }
    }
  }

  if (discharge === 0) {
    const importRoom = cap == null ? Number.POSITIVE_INFINITY : Math.max(0, cap - deficit);
    let target = fleet.socMin;
    if ((input.strategy === "demand_peak_shave" || input.strategy === "combined") && cap != null) {
      const needMoreDc = Math.max(0, input.reserveSoc - soc);
      const futureDc = input.futureChargeAc * eta;
      const urgent = needMoreDc > 1e-8 && futureDc + 1e-8 < needMoreDc;
      const earliest = input.strategy === "demand_peak_shave" && needMoreDc > 1e-8;
      const cheapReserve = input.strategy === "combined" && input.cheapest && needMoreDc > 1e-8;
      if (earliest || urgent || cheapReserve) target = Math.max(target, input.reserveSoc);
    }
    if ((input.strategy === "tou_arbitrage" || input.strategy === "combined") && input.cheapest && input.futureTouAc > 0) {
      const touTarget = Math.min(fleet.socMax, fleet.socMin + input.futureTouAc / eta);
      target = Math.max(target, touTarget);
    }
    const needAc = (Math.min(fleet.socMax, target) - soc) / eta;
    if (needAc > 1e-10 && importRoom > 0) takeCharge(Math.min(importRoom, needAc));
  }

  if (soc < fleet.socMin) soc = fleet.socMin;
  if (soc > fleet.socMax) soc = fleet.socMax;
  return { soc, chargeAc: charge, dischargeAc: discharge };
}

function minimumThreshold(span: MonthSpan, fleet: Fleet, deficit: Float64Array, excess: Float64Array): number {
  let maxDeficit = 0;
  for (let hour = span.start; hour < span.end; hour += 1) {
    if (deficit[hour] > maxDeficit) maxDeficit = deficit[hour];
  }
  if (monthHolds(span, fleet, deficit, excess, 0)) return 0;
  let low = 0;
  let high = maxDeficit;
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    if (monthHolds(span, fleet, deficit, excess, mid)) high = mid;
    else low = mid;
  }
  return high;
}

function monthHolds(
  span: MonthSpan,
  fleet: Fleet,
  deficit: Float64Array,
  excess: Float64Array,
  threshold: number,
): boolean {
  const look = buildLookahead(span, threshold, fleet, deficit, excess);
  let soc = fleet.socMin;
  for (let hour = span.start; hour < span.end; hour += 1) {
    // Deficit and excess are mutually exclusive, so they are the net load and net solar.
    const step = decideHour({
      soc,
      fleet,
      load: deficit[hour],
      solar: excess[hour],
      strategy: "demand_peak_shave",
      thresholdKw: threshold,
      reserveSoc: look.reserveSoc[hour],
      futureChargeAc: look.futureChargeAc[hour],
      futureTouAc: 0,
      cheapest: false,
      profitableDischarge: false,
    });
    soc = step.soc;
    const imported = deficit[hour] - excess[hour] + step.chargeAc - step.dischargeAc;
    if (imported > threshold + TOLERANCE_KW) return false;
  }
  return true;
}

function buildLookahead(
  span: MonthSpan,
  threshold: number,
  fleet: Fleet,
  deficit: Float64Array,
  excess: Float64Array,
): Lookahead {
  const reserveSoc = new Float64Array(HOURS_PER_YEAR);
  const futureChargeAc = new Float64Array(HOURS_PER_YEAR);
  const opportunity = new Float64Array(HOURS_PER_YEAR);
  type Cluster = { start: number; end: number; ac: number };
  const clusters: Cluster[] = [];
  let hour = span.start;
  while (hour < span.end) {
    if (deficit[hour] > threshold) {
      const start = hour;
      let ac = 0;
      while (hour < span.end && deficit[hour] > threshold) {
        ac += deficit[hour] - threshold;
        hour += 1;
      }
      clusters.push({ start, end: hour, ac });
    } else {
      const solarAc = Math.min(fleet.maxCharge, excess[hour]);
      const powerLeft = fleet.maxCharge - solarAc;
      const gridRoom = Math.max(0, threshold - deficit[hour]);
      opportunity[hour] = solarAc + Math.min(powerLeft, gridRoom);
      hour += 1;
    }
  }

  const prefix = new Float64Array(span.end - span.start + 1);
  for (let index = span.start; index < span.end; index += 1) {
    prefix[index - span.start + 1] = prefix[index - span.start] + opportunity[index];
  }
  const prefixAt = (absolute: number): number => prefix[absolute - span.start];

  let clusterIndex = 0;
  for (let index = span.start; index < span.end; index += 1) {
    if (deficit[index] > threshold) {
      const cluster = clusters[clusterIndex];
      if (!cluster || index >= cluster.end) {
        while (clusterIndex < clusters.length && index >= clusters[clusterIndex].end) clusterIndex += 1;
      }
      const current = clusters[clusterIndex];
      let rest = 0;
      if (current && index >= current.start && index < current.end) {
        for (let later = index + 1; later < current.end; later += 1) rest += deficit[later] - threshold;
        reserveSoc[index] = Math.min(fleet.socMax, fleet.socMin + rest / fleet.eta);
      } else {
        reserveSoc[index] = fleet.socMin;
      }
      continue;
    }
    while (clusterIndex < clusters.length && clusters[clusterIndex].start <= index) clusterIndex += 1;
    const next = clusters[clusterIndex];
    if (!next) {
      reserveSoc[index] = fleet.socMin;
      continue;
    }
    reserveSoc[index] = Math.min(fleet.socMax, fleet.socMin + next.ac / fleet.eta);
    futureChargeAc[index] = prefixAt(next.start) - prefixAt(index + 1);
  }
  return { reserveSoc, futureChargeAc };
}

function buildTouSignals(
  importRate: number[],
  covered: readonly boolean[],
  deficit: Float64Array,
  fleet: Fleet,
): TouSignals {
  const cheapest = new Uint8Array(HOURS_PER_YEAR);
  const profitable = new Uint8Array(HOURS_PER_YEAR);
  const futureTouAc = new Float64Array(HOURS_PER_YEAR);
  const dayCount = HOURS_PER_YEAR / 24;
  for (let day = 0; day < dayCount; day += 1) {
    const start = day * 24;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let hour = start; hour < start + 24; hour += 1) {
      if (!covered[hour]) continue;
      if (importRate[hour] < min) min = importRate[hour];
      if (importRate[hour] > max) max = importRate[hour];
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    const spreadPays = max * fleet.eta * fleet.eta > min + 1e-9;
    for (let hour = start; hour < start + 24; hour += 1) {
      if (!covered[hour]) continue;
      if (importRate[hour] <= min + 1e-9) cheapest[hour] = 1;
      if (spreadPays && importRate[hour] >= max - 1e-9) profitable[hour] = 1;
    }
  }
  // Discharge opportunity over the next 24 hours, so a cheap window after today's peak can
  // charge for tomorrow's peak instead of stopping at midnight.
  const contribution = new Float64Array(HOURS_PER_YEAR);
  const prefix = new Float64Array(HOURS_PER_YEAR + 1);
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    contribution[hour] = profitable[hour] === 1 ? Math.min(deficit[hour], fleet.maxDischarge) : 0;
    prefix[hour + 1] = prefix[hour] + contribution[hour];
  }
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const end = Math.min(HOURS_PER_YEAR, hour + 25);
    futureTouAc[hour] = prefix[end] - prefix[hour + 1];
  }
  return { cheapest, profitable, futureTouAc };
}

function readSeries(values: readonly number[], label: string): Float64Array {
  if (values.length !== HOURS_PER_YEAR) throw new Error(`${label} must have ${HOURS_PER_YEAR} hours.`);
  const series = new Float64Array(HOURS_PER_YEAR);
  for (let hour = 0; hour < HOURS_PER_YEAR; hour += 1) {
    const value = values[hour];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${label}[${hour}] must be zero or a positive finite number.`);
    }
    series[hour] = value;
  }
  return series;
}

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return total;
}

function billWithoutWarnings<T extends { warnings: string[] }>(priced: T): Omit<T, "warnings"> {
  const { warnings, ...rest } = priced;
  void warnings;
  return rest;
}

function dedupe(warnings: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const warning of warnings) {
    if (seen.has(warning)) continue;
    seen.add(warning);
    unique.push(warning);
  }
  return unique;
}

export function emptySeries(): number[] {
  return new Array<number>(HOURS_PER_YEAR).fill(0);
}
