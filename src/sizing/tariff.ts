import { roundTo } from "./round";

/** Rocky Mountain Power Utah Schedule 6, settlement design effective 2026-08-10. */
export const TARIFF_AS_OF = "2026-08-10";
export const SCHEDULE_CODE = "RMP_UT_6" as const;

export const CUSTOMER_CHARGE_USD_MO = 58;

/** Energy rates are stamped for a later TOU pass. v1 demand math does not use them. */
export const ENERGY_USD_PER_KWH = {
  summer: 0.040175,
  winter: 0.035527,
} as const;

/**
 * Stored in cents so $4.36 + $14.49 stays $18.85 and $4.36 + $12.82 stays $17.18.
 * Summer is June–September. Winter is October–May.
 */
const FACILITIES_CENTS_PER_KW = 436;
const POWER_CENTS_PER_KW = { summer: 1449, winter: 1282 } as const;

export type DemandSeason = "summer" | "winter";

export type TariffStamp = {
  asOf: string;
  facilitiesUsdPerKw: number;
  powerUsdPerKw: { summer: number; winter: number };
};

export const RMP_SCHED_6_STAMP: TariffStamp = {
  asOf: TARIFF_AS_OF,
  facilitiesUsdPerKw: FACILITIES_CENTS_PER_KW / 100,
  powerUsdPerKw: {
    summer: POWER_CENTS_PER_KW.summer / 100,
    winter: POWER_CENTS_PER_KW.winter / 100,
  },
};

export type DemandRate = {
  season: DemandSeason;
  facilitiesUsdPerKw: number;
  powerUsdPerKw: number;
  usdPerKwMo: number;
  asOf: string;
};

export function demandRate(season: DemandSeason, stamp: TariffStamp = RMP_SCHED_6_STAMP): DemandRate {
  const facilitiesCents = Math.round(stamp.facilitiesUsdPerKw * 100);
  const powerCents = Math.round(stamp.powerUsdPerKw[season] * 100);
  return {
    season,
    facilitiesUsdPerKw: facilitiesCents / 100,
    powerUsdPerKw: powerCents / 100,
    usdPerKwMo: (facilitiesCents + powerCents) / 100,
    asOf: stamp.asOf,
  };
}

export function grossDemandUsd(pBattKw: number, usdPerKwMo: number): number {
  const cents = Math.round(usdPerKwMo * 100);
  return Math.round(pBattKw * cents) / 100;
}

export function seasonFromCalendarMonth(month: number): DemandSeason {
  return month >= 6 && month <= 9 ? "summer" : "winter";
}

/** Local calendar month from a YYYY-MM-DD prefix. Ignores timezone shifts. */
export function seasonFromTimestamp(ts: string): DemandSeason | null {
  const match = /^(\d{4})-(\d{2})/.exec(ts);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return seasonFromCalendarMonth(month);
}

/** Fixture month_index is 0-based (July = 6). */
export function seasonFromMonthIndex(monthIndex: number): DemandSeason | null {
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  return seasonFromCalendarMonth(monthIndex + 1);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(roundTo(amount, 2)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
