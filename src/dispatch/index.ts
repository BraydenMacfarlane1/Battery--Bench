export {
  BILLED_PEAK_SCALE_CAVEAT,
  DEFAULT_DEGRADATION_PER_YEAR,
  DEFAULT_ROUND_TRIP_EFFICIENCY,
  HOURLY_DEMAND_CAVEAT,
  MODEL_ASSUMPTIONS,
} from "./assumptions";
export {
  ALL_HOURS,
  DAYS_IN_MONTH,
  HOURS_PER_YEAR,
  NO_HOURS,
  buildCalendar,
  hourMask,
  hoursBetween,
  monthInSeason,
  monthSpans,
} from "./calendar";
export type { HourStamp } from "./calendar";
export { assertRateModel, demandScaleByMonth, hourlyPrices, monthlyPeaks, priceYear, windowCovers } from "./bill";
export { rmpSchedule6Rate } from "./rmp-schedule-6";
export {
  DEFAULT_ANALYSIS_YEARS,
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_RATE_ESCALATOR,
  installedCost,
  internalRateOfReturn,
  netPresentValue,
  savingsCashFlows,
  simplePaybackYears,
} from "./economics";
export {
  BACKUP_ASSUMPTIONS,
  BACKUP_HORIZON_HOURS,
  DEFAULT_BACKUP_LOAD_FRACTION,
  estimateBackup,
  formatBackupHeadline,
  formatBackupPowerLimit,
} from "./backup";
export type { BackupEstimate, BackupEstimateInput, BackupLoadMode, BackupLoadShape, BackupScenario } from "./backup";
export {
  BACKUP_DURATION,
  BEST_PAYBACK,
  CHEAPEST_PEAK_TARGET,
  DEFAULT_RANKING_MODE,
  MAX_ANNUAL_SAVINGS,
  MAX_LIFETIME_NPV,
  MAX_SELF_CONSUMPTION,
  RANKING_MODES,
  batteryMissesConstraint,
  bestQuantityForBattery,
  constraintMissLabel,
  meetsRankingConstraint,
  MAX_SWEEP_POINTS,
  planSweepQuantities,
  quantitiesForBattery,
  rankCandidates,
  rankingMode,
  sweepBatteries,
} from "./rank";
export type { CandidateMetrics, RankContext, RankingMode, SweepInput } from "./rank";
export { decideHour, emptySeries, fleetOf, resolveDegradation, resolveRoundTrip, simulateDispatch } from "./simulate";
export type { Fleet } from "./simulate";
export type {
  AnnualBill,
  Battery,
  DemandComponent,
  DemandLine,
  DispatchStrategy,
  EnergyPeriod,
  HourMask,
  HourlyDispatch,
  MonthBill,
  RateModel,
  SeasonDef,
  SimulationInput,
  SimulationResult,
  SimulationTotals,
} from "./types";
