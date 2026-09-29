import { DEFAULT_ROUND_TRIP_EFFICIENCY } from "../dispatch/assumptions";
import { ALL_HOURS, HOURS_PER_YEAR } from "../dispatch/calendar";
import type { Battery, DemandComponent, EnergyPeriod, HourMask, RateModel, SeasonDef } from "../dispatch/types";
import {
  TARIFF_INCOMPLETE,
  type NormalizedEconomics,
  type NormalizedRate,
  type NormalizedSolarSeries,
  type NormalizedStudy,
  type ProjectListItem,
} from "./types";

const EXPORT_CREDIT_FIELDS = [
  "export_credit_kwh",
  "export_rate_kwh",
  "export_credit_rate",
  "nem_export_rate_kwh",
  "excess_generation_rate",
  "excess_generation_credit_kwh",
] as const;

type WarningBag = string[];

export function normalizeProjectExport(body: unknown): NormalizedStudy {
  const warnings: WarningBag = [];
  const root = asRecord(body);
  if (!root) {
    return emptyStudy(warnings.concat("Sun Daddy project export was not a JSON object."));
  }
  const schema = typeof root.schema_version === "number" ? root.schema_version : null;
  if (schema != null && schema !== 1) {
    warnings.push(`Export schema_version ${schema} is newer than this normalizer (1). Some fields may be dropped.`);
  }

  const project = asRecord(root.project) ?? root;
  const projectId = readString(project.id) ?? readString(root.id);
  const projectName = readString(project.name) ?? readString(project.title) ?? readString(root.name);

  const load = asRecord(root.load);
  const hourlyLoad = readHourly(load?.hourly_kwh, "Load", warnings);
  const monthly = readMonthly(load?.monthly_kwh, warnings);
  if (!hourlyLoad && monthly) {
    warnings.push("Only monthly kWh is available. Hourly dispatch needs an 8,760-hour load and will not invent a shape.");
  }
  const billed = readPeaks(load?.profiles, warnings);

  const solarBlock = asRecord(root.solar);
  const solarSeries = readSolarSeries(solarBlock?.series, warnings);
  const solarSum = sumSolar(solarSeries);

  const preSource = resolvePreRate(root, warnings);
  const preRate = normalizeRatePair(preSource.rate, preSource.nem, "Pre-battery rate");
  const postRates = readPostRates(root.rates);
  warnings.push(...preRate.warnings);
  for (const post of postRates) warnings.push(...post.warnings);
  const batteries = normalizeBatteryList(root.batteries, warnings);
  const economics = normalizeEconomics(asRecord(project.economics) ?? asRecord(root.economics), warnings);

  return {
    schema_version: schema,
    project_id: projectId,
    project_name: projectName,
    warnings: dedupe(warnings),
    load_kwh: hourlyLoad,
    monthly_kwh: monthly,
    billed_peak_kw: billed,
    solar_kwh: solarSum,
    solar_series: solarSeries,
    pre_rate: preRate,
    post_rates: postRates,
    batteries,
    economics,
  };
}

export function normalizeBatteryCatalog(body: unknown): { batteries: Battery[]; warnings: string[] } {
  const warnings: WarningBag = [];
  const root = asRecord(body);
  const list = Array.isArray(body) ? body : root?.batteries ?? root?.items;
  return { batteries: normalizeBatteryList(list, warnings), warnings: dedupe(warnings) };
}

export function normalizeProjectList(body: unknown): { projects: ProjectListItem[]; warnings: string[] } {
  const warnings: WarningBag = [];
  const root = asRecord(body);
  const list = Array.isArray(body) ? body : root?.projects ?? root?.items;
  if (!Array.isArray(list)) {
    return { projects: [], warnings: ["Could not read the Sun Daddy project list."] };
  }
  const projects: ProjectListItem[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = readString(record.id) ?? readString(record.project_id);
    const name = readString(record.name) ?? readString(record.title) ?? readString(record.project_name) ?? id;
    if (!id || !name) {
      warnings.push("A project list entry had no id and was skipped.");
      continue;
    }
    projects.push({ id, name });
  }
  return { projects, warnings };
}

export function normalizeRatePair(rateBody: unknown, nemBody: unknown, label: string): NormalizedRate {
  const warnings: WarningBag = [];
  if (!asRecord(rateBody) && !asRecord(nemBody)) {
    return { rate: null, warnings: [`${label} was missing.`] };
  }
  const built = rateBody ? buildRateModel(rateBody, warnings) : null;
  const model = applyExportCredit(built ?? emptyRate(label), rateBody, nemBody, warnings);
  return { rate: model, warnings: dedupe(warnings) };
}

function buildRateModel(body: unknown, warnings: WarningBag): RateModel | null {
  const rate = asRecord(body);
  if (!rate) {
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push("The rate payload was not an object.");
    return null;
  }
  const columns = asRecord(rate.rate_schedules) ?? rate;
  const modelJson = asRecord(rate.model_json) ?? asRecord(columns.model_json);
  const seasons = readSeasons(modelJson?.seasons) ?? readSeasons(rate.seasons) ?? readSeasons(columns.seasons) ?? [];
  const name = readString(columns.name) ?? readString(rate.name) ?? undefined;
  const id = readString(columns.id) ?? readString(rate.id) ?? undefined;

  const components = Array.isArray(modelJson?.components) ? modelJson.components : null;
  if (components && components.length > 0) {
    return fromComponents({ id, name, seasons, components, columns, rate, modelJson, warnings });
  }
  return fromScheduleTables({ id, name, seasons, columns, rate, modelJson, warnings });
}

function fromComponents(args: {
  id: string | undefined;
  name: string | undefined;
  seasons: SeasonDef[];
  components: unknown[];
  columns: Record<string, unknown>;
  rate: Record<string, unknown>;
  modelJson: Record<string, unknown> | null;
  warnings: WarningBag;
}): RateModel {
  const energy: EnergyPeriod[] = [];
  const demand: DemandComponent[] = [];
  let fixed = 0;
  let sawFixed = false;
  let incomplete = false;

  args.components.forEach((entry, index) => {
    const component = asRecord(entry);
    if (!component) {
      incomplete = true;
      args.warnings.push(`Component ${index + 1} was not an object and was skipped.`);
      return;
    }
    const kind = readString(component.kind);
    const componentName = readString(component.name) ?? `${kind ?? "component"} ${index + 1}`;
    if (kind === "percent") {
      incomplete = true;
      args.warnings.push(`${componentName} is a percent component and was not priced.`);
      return;
    }
    if (kind !== "energy" && kind !== "import_kwh" && kind !== "demand" && kind !== "fixed") {
      incomplete = true;
      args.warnings.push(`${componentName} has unsupported kind ${kind ?? "(missing)"} and was skipped.`);
      return;
    }
    const amount = readRateAmount(component);
    if (amount == null) {
      incomplete = true;
      args.warnings.push(`${componentName} had no numeric rate and was skipped.`);
      return;
    }
    const scope = readScope(component, args.seasons, componentName, args.warnings);
    if (scope === "bad") {
      incomplete = true;
      return;
    }
    if (kind === "fixed") {
      if (scope.seasonal) {
        incomplete = true;
        args.warnings.push(`${componentName} is a seasonal fixed charge and was not priced.`);
        return;
      }
      fixed += amount;
      sawFixed = true;
      return;
    }
    if (!scope.masks) {
      incomplete = true;
      args.warnings.push(`${componentName} had no 24-hour weekday/weekend mask and was skipped.`);
      return;
    }
    if (kind === "demand") {
      demand.push({
        name: componentName,
        season_ids: scope.seasonIds,
        months: scope.months,
        weekday_hours: scope.masks.weekday,
        weekend_hours: scope.masks.weekend,
        demand_rate_kw: amount,
        is_facilities: component.is_facilities === true,
      });
      return;
    }
    energy.push({
      name: componentName,
      season_ids: scope.seasonIds,
      months: scope.months,
      weekday_hours: scope.masks.weekday,
      weekend_hours: scope.masks.weekend,
      energy_rate_kwh: amount,
    });
  });

  const columnFixed = readFinite(args.columns.fixed_monthly_charge);
  if (sawFixed && columnFixed != null && Math.abs(columnFixed - fixed) > 0.001) {
    incomplete = true;
    args.warnings.push("The schedule customer charge differs from the fixed components. The components were used.");
  }
  if (!sawFixed && columnFixed != null) fixed = columnFixed;

  noteScheduleLimits(args.rate, args.columns, args.modelJson, args.warnings, () => {
    incomplete = true;
  });
  if (nonEmptyPeriods(args.rate.tou_periods) || nonEmptyPeriods(args.columns.tou_periods)) {
    incomplete = true;
    args.warnings.push("TOU period rows were ignored because model_json components are present.");
  }
  if (incomplete) args.warnings.unshift(TARIFF_INCOMPLETE);

  return {
    id: args.id,
    name: args.name,
    seasons: args.seasons,
    energy_periods: energy,
    demand_components: demand,
    fixed_monthly_charge: fixed,
    export_credit_kwh: 0,
    ...optionalBillFlags(args.modelJson),
  };
}

function fromScheduleTables(args: {
  id: string | undefined;
  name: string | undefined;
  seasons: SeasonDef[];
  columns: Record<string, unknown>;
  rate: Record<string, unknown>;
  modelJson: Record<string, unknown> | null;
  warnings: WarningBag;
}): RateModel {
  const energy: EnergyPeriod[] = [];
  const demand: DemandComponent[] = [];
  let incomplete = false;
  const tou = readPeriodRows(args.rate.tou_periods ?? args.columns.tou_periods);
  const flat = readPeriodRows(args.rate.flat_periods ?? args.columns.flat_periods);
  let sawEnergy = false;

  for (const row of tou) {
    const parsed = periodToCharges(row, args.seasons, false, args.warnings);
    if (!parsed) {
      incomplete = true;
      continue;
    }
    if (parsed.energy) {
      energy.push(parsed.energy);
      sawEnergy = true;
    }
    if (parsed.demand) demand.push(parsed.demand);
  }
  for (const row of flat) {
    const parsed = periodToCharges(row, args.seasons, true, args.warnings);
    if (!parsed) {
      incomplete = true;
      continue;
    }
    if (parsed.energy) {
      energy.push(parsed.energy);
      sawEnergy = true;
    }
    if (parsed.demand) demand.push(parsed.demand);
  }

  if (nonEmptyPeriods(args.rate.tiered_periods) || nonEmptyPeriods(args.columns.tiered_periods)) {
    incomplete = true;
    args.warnings.push("Tiered energy is not modeled and was not approximated.");
  }

  const delivery = readFinite(args.columns.delivery_rate_kwh) ?? 0;
  const surcharge = readFinite(args.columns.surcharge_rate_kwh) ?? 0;
  if (delivery !== 0 || surcharge !== 0) {
    if (sawEnergy) {
      incomplete = true;
      args.warnings.push("Delivery or surcharge is present alongside TOU energy rates and was not added on top.");
    } else {
      energy.push({
        name: "Delivery and surcharge",
        weekday_hours: ALL_HOURS,
        weekend_hours: ALL_HOURS,
        energy_rate_kwh: delivery + surcharge,
      });
    }
  }

  const seasonalFacilities = facilitiesFromSeasons(args.rate.seasons ?? args.columns.seasons);
  const columnFacilities = readFinite(args.columns.facilities_charge_kw);
  if (seasonalFacilities.length > 0) {
    demand.push(...seasonalFacilities);
    if (columnFacilities != null) {
      incomplete = true;
      args.warnings.push("Facilities are listed on both the schedule and the seasons. The seasonal rates were used.");
    }
  } else if (columnFacilities != null) {
    demand.push({
      name: "Facilities",
      weekday_hours: ALL_HOURS,
      weekend_hours: ALL_HOURS,
      demand_rate_kw: columnFacilities,
      is_facilities: true,
    });
  }

  noteScheduleLimits(args.rate, args.columns, args.modelJson, args.warnings, () => {
    incomplete = true;
  });
  if (incomplete) args.warnings.unshift(TARIFF_INCOMPLETE);

  return {
    id: args.id,
    name: args.name,
    seasons: args.seasons,
    energy_periods: energy,
    demand_components: demand,
    fixed_monthly_charge: readFinite(args.columns.fixed_monthly_charge) ?? 0,
    export_credit_kwh: 0,
    ...optionalBillFlags(args.modelJson),
  };
}

function applyExportCredit(
  model: RateModel,
  rateBody: unknown,
  nemBody: unknown,
  warnings: WarningBag,
): RateModel {
  const nem = asRecord(nemBody);
  const base = asRecord(rateBody);
  const nemColumns = nem ? (asRecord(nem.rate_schedules) ?? nem) : null;
  const baseColumns = base ? (asRecord(base.rate_schedules) ?? base) : null;
  const extraEnergy: EnergyPeriod[] = [];
  let exportCredit = model.export_credit_kwh;
  if (nem) {
    const credit = readExportCredit(nemColumns ?? nem);
    const tou = readPeriodRows(nem.tou_periods ?? nemColumns?.tou_periods);
    const exportPeriods = tou.filter((row) => readFinite(row.export_rate_kwh) != null);
    if (exportPeriods.length > 0) {
      const seasons = model.seasons;
      for (const row of exportPeriods) {
        const masks = masksFromRow(row, true);
        if (!masks) {
          warnings.push(TARIFF_INCOMPLETE);
          warnings.push("A NEM export period had no hour mask and was skipped.");
          continue;
        }
        extraEnergy.push({
          name: readString(row.period_name) ?? "NEM export",
          months: readMonthList(row.applies_months) ?? undefined,
          weekday_hours: masks.weekday,
          weekend_hours: masks.weekend,
          energy_rate_kwh: 0,
          export_rate_kwh: readFinite(row.export_rate_kwh) ?? 0,
          season_ids: seasons.length === 1 ? [seasons[0].id] : undefined,
        });
      }
      return { ...model, energy_periods: [...model.energy_periods, ...extraEnergy] };
    }
    if (credit) {
      if (credit.ambiguous) {
        warnings.push(TARIFF_INCOMPLETE);
        warnings.push("The NEM rate has more than one export credit field and none was applied.");
        return model;
      }
      exportCredit = credit.value;
      return { ...model, export_credit_kwh: exportCredit };
    }
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push("Export credits were not found on the linked NEM rate.");
    return model;
  }
  const own = baseColumns ? readExportCredit(baseColumns) : null;
  if (own && !own.ambiguous) return { ...model, export_credit_kwh: own.value };
  if (own?.ambiguous) {
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push("More than one export credit field is set and none was applied.");
  }
  return model;
}

function noteScheduleLimits(
  rate: Record<string, unknown>,
  columns: Record<string, unknown>,
  modelJson: Record<string, unknown> | null,
  warnings: WarningBag,
  mark: () => void,
): void {
  const threshold = readFinite(columns.demand_threshold_kw);
  if (threshold != null && threshold > 0) {
    mark();
    warnings.push("A demand threshold is set and was not applied. Demand is priced on the full window peak.");
  }
  if (readFinite(columns.tax_rate) != null || (modelJson && readFinite(modelJson.tax_rate) != null)) {
    mark();
    warnings.push("A tax rate was present and was not applied, because it is not clear if it is a percent or a fraction.");
  }
  const trueUp =
    columns.true_up_month != null ||
    columns.true_up_day != null ||
    rate.true_up != null ||
    (modelJson ? modelJson.true_up != null : false);
  if (trueUp) {
    mark();
    warnings.push("Annual true-up is not modeled. Export credits are applied in the month they occur.");
  }
  const netting = modelJson ? readString(modelJson.netting) : null;
  if (netting && netting.toLowerCase() !== "hourly") {
    mark();
    warnings.push(`This tariff's netting is ${netting}. The bill is still netted each hour.`);
  }
  const minBill = modelJson ? readFinite(modelJson.min_bill) : null;
  if (minBill != null && minBill < 0) {
    mark();
    warnings.push("A negative minimum bill was ignored.");
  }
}

function optionalBillFlags(modelJson: Record<string, unknown> | null): Pick<RateModel, "min_bill_usd"> {
  const minBill = modelJson ? readFinite(modelJson.min_bill) : null;
  if (minBill == null || minBill < 0) return {};
  return { min_bill_usd: minBill };
}

function periodToCharges(
  row: Record<string, unknown>,
  seasons: SeasonDef[],
  flat: boolean,
  warnings: WarningBag,
): { energy?: EnergyPeriod; demand?: DemandComponent } | null {
  const name = readString(row.period_name) ?? (flat ? "Flat" : "TOU");
  const masks = masksFromRow(row, flat);
  if (!masks) {
    warnings.push(`${name} had no 24-hour mask and was skipped.`);
    return null;
  }
  const months = readMonthList(row.applies_months);
  const seasonIds = matchSeasonsToMonths(seasons, months);
  const energyRate = readFinite(row.energy_rate_kwh);
  const demandRate = readFinite(row.demand_rate_kw);
  const exportRate = readFinite(row.export_rate_kwh);
  if (energyRate == null && demandRate == null && exportRate == null) {
    warnings.push(`${name} had no energy, demand, or export price and was skipped.`);
    return null;
  }
  const result: { energy?: EnergyPeriod; demand?: DemandComponent } = {};
  if (energyRate != null || exportRate != null) {
    result.energy = {
      name,
      season_ids: months ? undefined : seasonIds,
      months: months ?? undefined,
      weekday_hours: masks.weekday,
      weekend_hours: masks.weekend,
      energy_rate_kwh: energyRate ?? 0,
      ...(exportRate != null ? { export_rate_kwh: exportRate } : {}),
    };
  }
  if (demandRate != null) {
    result.demand = {
      name,
      season_ids: months ? undefined : seasonIds,
      months: months ?? undefined,
      weekday_hours: masks.weekday,
      weekend_hours: masks.weekend,
      demand_rate_kw: demandRate,
      is_facilities: false,
    };
  }
  return result;
}

function facilitiesFromSeasons(value: unknown): DemandComponent[] {
  if (!Array.isArray(value)) return [];
  const components: DemandComponent[] = [];
  value.forEach((entry, index) => {
    const season = asRecord(entry);
    if (!season) return;
    const rate = readFinite(season.facilities_rate_kw);
    const start = readFinite(season.start_month);
    const end = readFinite(season.end_month);
    if (rate == null || start == null || end == null) return;
    const id = readString(season.id) ?? `season-${index + 1}`;
    components.push({
      name: `Facilities ${id}`,
      season_ids: [id],
      weekday_hours: ALL_HOURS,
      weekend_hours: ALL_HOURS,
      demand_rate_kw: rate,
      is_facilities: true,
    });
  });
  return components;
}

function readScope(
  component: Record<string, unknown>,
  seasons: SeasonDef[],
  name: string,
  warnings: WarningBag,
):
  | { seasonal: boolean; seasonIds?: string[]; months?: number[]; masks: { weekday: HourMask; weekend: HourMask } | null }
  | "bad" {
  const seasonIds = readStringList(component.season_ids);
  if (seasonIds) {
    const known = new Set(seasons.map((season) => season.id));
    const missing = seasonIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      warnings.push(`${name} references unknown season ${missing.join(", ")} and was skipped.`);
      return "bad";
    }
  }
  const months = readMonthList(component.months);
  const facilities = component.is_facilities === true;
  const weekday = asMask(component.weekday_hours);
  const weekend = asMask(component.weekend_hours);
  let masks: { weekday: HourMask; weekend: HourMask } | null = null;
  if (facilities) {
    masks = { weekday: ALL_HOURS, weekend: ALL_HOURS };
  } else if (weekday && weekend) {
    masks = { weekday, weekend };
  }
  const seasonal = (seasonIds != null && seasonIds.length > 0) || (months != null && months.length > 0);
  return { seasonal, seasonIds: seasonIds ?? undefined, months: months ?? undefined, masks };
}

function masksFromRow(row: Record<string, unknown>, flat: boolean): { weekday: HourMask; weekend: HourMask } | null {
  const weekday = asMask(row.weekday_hours);
  const weekend = asMask(row.weekend_hours);
  if (weekday && weekend) return { weekday, weekend };
  if (flat && row.weekday_hours == null && row.weekend_hours == null) return { weekday: ALL_HOURS, weekend: ALL_HOURS };
  return null;
}

function readExportCredit(record: Record<string, unknown>): { value: number; ambiguous: boolean } | null {
  const found: number[] = [];
  for (const field of EXPORT_CREDIT_FIELDS) {
    if (record[field] == null) continue;
    const value = readFinite(record[field]);
    if (value == null) continue;
    found.push(value);
  }
  if (found.length === 0) return null;
  const first = found[0];
  const ambiguous = found.some((value) => Math.abs(value - first) > 1e-9);
  return { value: first, ambiguous };
}

function resolvePreRate(root: Record<string, unknown>, warnings: WarningBag): { rate: unknown; nem: unknown } {
  const rates = asRecord(root.rates);
  const pre = asRecord(rates?.pre);
  if (pre && (pre.rate != null || pre.nem_rate != null)) {
    return { rate: pre.rate, nem: pre.nem_rate };
  }
  const load = asRecord(root.load);
  const profiles = Array.isArray(load?.profiles) ? load.profiles : [];
  const first = asRecord(profiles[0]);
  if (first && (first.pre_rate != null || first.nem_rate != null)) {
    warnings.push("rates.pre was missing. The first load profile's rate was used.");
    return { rate: first.pre_rate, nem: first.nem_rate };
  }
  return { rate: null, nem: null };
}

function readPostRates(value: unknown): NormalizedRate[] {
  const rates = asRecord(value);
  const post = rates?.post;
  if (!Array.isArray(post)) return [];
  return post.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) return { rate: null, warnings: [`Post rate ${index + 1} was not an object.`] };
    return normalizeRatePair(record.rate, record.nem_rate, `Post rate ${index + 1}`);
  });
}

function normalizeEconomics(economics: Record<string, unknown> | null, warnings: WarningBag): NormalizedEconomics {
  return {
    discount_rate: percentField(economics?.discount_rate, "discount_rate", warnings),
    rate_escalator: percentField(economics?.rate_escalator, "rate_escalator", warnings),
    federal_tax_rate: percentField(economics?.federal_tax_rate, "federal_tax_rate", warnings),
    state_tax_rate: percentField(economics?.state_tax_rate, "state_tax_rate", warnings),
    analysis_period: integerField(economics?.analysis_period, "analysis_period", warnings),
    system_size_kw: readFinite(economics?.system_size_kw),
  };
}

function normalizeBatteryList(value: unknown, warnings: WarningBag): Battery[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("Battery list was not an array and was skipped.");
    return [];
  }
  const batteries: Battery[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const usable = readFinite(record.usable_capacity_kwh);
    const charge = readFinite(record.max_charge_rate_kw);
    const discharge = readFinite(record.max_discharge_rate_kw);
    const cost = readFinite(record.cost_per_unit);
    const name = readString(record.name) ?? readString(record.model) ?? readString(record.id);
    if (usable == null || charge == null || discharge == null || cost == null || !name || !(usable > 0)) {
      warnings.push(`Battery ${name ?? "(unnamed)"} is missing capacity, power, or cost and was skipped.`);
      continue;
    }
    const additional = readFinite(record.cost_per_additional_unit);
    const rte = record.round_trip_efficiency == null ? DEFAULT_ROUND_TRIP_EFFICIENCY : readFinite(record.round_trip_efficiency);
    if (rte == null) {
      warnings.push(`${name} has a non-numeric round-trip efficiency. The 0.90 default was used.`);
    }
    const id = readString(record.id) ?? name;
    batteries.push({
      id,
      name,
      manufacturer: readString(record.manufacturer) ?? undefined,
      model: readString(record.model) ?? undefined,
      usable_capacity_kwh: usable,
      max_charge_rate_kw: charge,
      max_discharge_rate_kw: discharge,
      cost_per_unit: cost,
      cost_per_additional_unit: additional ?? undefined,
      round_trip_efficiency: rte ?? DEFAULT_ROUND_TRIP_EFFICIENCY,
    });
  }
  return batteries;
}

function readSolarSeries(value: unknown, warnings: WarningBag): NormalizedSolarSeries[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("Solar series was not an array and was skipped.");
    return [];
  }
  return value.map((entry, index) => {
    const record = asRecord(entry);
    const label = readString(record?.label) ?? `Series ${index + 1}`;
    if (!record) return { solar_type: null, label, annual_kwh: null, hourly_kwh: null };
    const hourly = readHourly(record.hourly_kwh, `Solar ${label}`, warnings);
    return {
      solar_type: readString(record.solar_type),
      label,
      annual_kwh: readFinite(record.annual_kwh),
      hourly_kwh: hourly,
    };
  });
}

function sumSolar(series: readonly NormalizedSolarSeries[]): number[] | null {
  const usable = series.filter((entry) => entry.hourly_kwh);
  if (usable.length === 0) return null;
  const total = new Array<number>(HOURS_PER_YEAR).fill(0);
  for (const entry of usable) {
    entry.hourly_kwh?.forEach((value, hour) => {
      total[hour] += value;
    });
  }
  return total;
}

function readPeaks(value: unknown, warnings: WarningBag): (number | null)[] {
  const peaks = new Array<number | null>(12).fill(null);
  if (!Array.isArray(value) || value.length === 0) return peaks;
  if (value.length > 1) {
    warnings.push("Multiple load profiles are present. Billed peaks come from the first profile only.");
  }
  const profile = asRecord(value[0]);
  const rows = profile && Array.isArray(profile.peaks) ? profile.peaks : [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const month = readFinite(record.month);
    const peak = readFinite(record.peak_kw);
    if (month == null || peak == null || peak < 0) continue;
    const index = month >= 1 && month <= 12 ? month - 1 : null;
    if (index == null) {
      warnings.push(`Billed peak month ${month} is outside 1–12 and was skipped.`);
      continue;
    }
    peaks[index] = peaks[index] == null ? peak : Math.max(peaks[index], peak);
  }
  return peaks;
}

function readHourly(value: unknown, label: string, warnings: WarningBag): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    warnings.push(`${label} hourly series was not an array and was skipped.`);
    return null;
  }
  if (value.length !== HOURS_PER_YEAR) {
    warnings.push(`${label} hourly series has ${value.length} values instead of ${HOURS_PER_YEAR} and was not used.`);
    return null;
  }
  const series: number[] = [];
  let gaps = 0;
  for (const entry of value) {
    if (entry == null) {
      gaps += 1;
      series.push(Number.NaN);
      continue;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
      warnings.push(`${label} hourly series has a non-numeric value and was not used.`);
      return null;
    }
    series.push(entry);
  }
  if (gaps > 0) {
    warnings.push(`${label} is missing ${gaps} hours. Those hours were not filled in, so the hourly series was not used.`);
    return null;
  }
  return series;
}

function readMonthly(value: unknown, warnings: WarningBag): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 12) {
    warnings.push("Monthly kWh must be 12 numbers to be used.");
    return null;
  }
  const months: number[] = [];
  for (const entry of value) {
    if (entry == null) {
      warnings.push("Monthly kWh has a gap and was not used.");
      return null;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
      warnings.push("Monthly kWh has a non-numeric value and was not used.");
      return null;
    }
    months.push(entry);
  }
  return months;
}

function readSeasons(value: unknown): SeasonDef[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seasons: SeasonDef[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) return null;
    const start = readFinite(record.start_month);
    const end = readFinite(record.end_month);
    if (start == null || end == null) return null;
    seasons.push({
      id: readString(record.id) ?? `season-${seasons.length + 1}`,
      start_month: start,
      end_month: end,
    });
  }
  return seasons;
}

function readPeriodRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(asRecord);
}

function nonEmptyPeriods(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function percentField(value: unknown, label: string, warnings: WarningBag): number | null {
  if (value == null) return null;
  const numeric = readFinite(value);
  if (numeric == null) {
    warnings.push(`${label} was not a number and was left blank.`);
    return null;
  }
  return numeric / 100;
}

function integerField(value: unknown, label: string, warnings: WarningBag): number | null {
  if (value == null) return null;
  const numeric = readFinite(value);
  if (numeric == null || !Number.isInteger(numeric)) {
    warnings.push(`${label} was not a whole number and was left blank.`);
    return null;
  }
  return numeric;
}

function readRateAmount(component: Record<string, unknown>): number | null {
  return (
    readFinite(component.rate) ??
    readFinite(component.amount) ??
    readFinite(component.energy_rate_kwh) ??
    readFinite(component.demand_rate_kw)
  );
}

function readMonthList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const months: number[] = [];
  for (const entry of value) {
    const month = readFinite(entry);
    if (month == null || !Number.isInteger(month) || month < 1 || month > 12) return null;
    months.push(month);
  }
  return months;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) return null;
    ids.push(entry);
  }
  return ids;
}

function matchSeasonsToMonths(seasons: SeasonDef[], months: number[] | null): string[] | undefined {
  if (!months || seasons.length === 0) return undefined;
  const ids = seasons
    .filter((season) => months.some((month) => monthIn(month, season.start_month, season.end_month)))
    .map((season) => season.id);
  return ids.length > 0 ? ids : undefined;
}

function monthIn(month: number, start: number, end: number): boolean {
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

function asMask(value: unknown): HourMask | null {
  if (!Array.isArray(value) || value.length !== 24 || value.some((bit) => typeof bit !== "boolean")) return null;
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function emptyRate(label: string): RateModel {
  return {
    name: label,
    seasons: [],
    energy_periods: [],
    demand_components: [],
    fixed_monthly_charge: 0,
    export_credit_kwh: 0,
  };
}

function emptyStudy(warnings: string[]): NormalizedStudy {
  return {
    schema_version: null,
    project_id: null,
    project_name: null,
    warnings,
    load_kwh: null,
    monthly_kwh: null,
    billed_peak_kw: new Array<number | null>(12).fill(null),
    solar_kwh: null,
    solar_series: [],
    pre_rate: { rate: null, warnings: [] },
    post_rates: [],
    batteries: [],
    economics: {
      discount_rate: null,
      rate_escalator: null,
      federal_tax_rate: null,
      state_tax_rate: null,
      analysis_period: null,
      system_size_kw: null,
    },
  };
}
