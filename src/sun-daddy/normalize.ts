import { DEFAULT_ROUND_TRIP_EFFICIENCY } from "../dispatch/assumptions";
import { ALL_HOURS, HOURS_PER_YEAR } from "../dispatch/calendar";
import type { Battery, DemandComponent, EnergyPeriod, HourMask, RateModel, SeasonDef } from "../dispatch/types";
import {
  TARIFF_INCOMPLETE,
  type BillCheck,
  type BillCheckGrade,
  type BillCheckStatus,
  type HourlySourceKind,
  type LoadHourlySource,
  type LoadProfileMeta,
  type NemScheduleInfo,
  type NormalizedEconomics,
  type NormalizedRate,
  type NormalizedSolarSeries,
  type NormalizedStudy,
  type ProjectFinance,
  type ProjectIncentive,
  type ProjectListItem,
  type RateVerification,
  type SelectedBattery,
  type SunDaddyResult,
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
  const economicsRecord = asRecord(project.economics) ?? asRecord(root.economics);
  const projectId = readId(project.id) ?? readId(economicsRecord?.id) ?? readId(root.id);
  const projectName =
    readString(project.name) ??
    readString(project.title) ??
    readString(project.label) ??
    readString(economicsRecord?.name) ??
    readString(economicsRecord?.label) ??
    readString(root.name) ??
    readString(root.title);

  const load = asRecord(root.load);
  const hourlyLoad = readHourly(load?.hourly_kwh, "Load", warnings);
  const hourlyClass = classifyHourlySource(firstProfileRecord(load)?.hourly_source ?? load?.hourly_source);
  const hourlySource = hourlyClass.legacy;
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
  const selectionSource = Array.isArray(project.batteries) ? project.batteries : economicsRecord?.batteries;
  const selectedBatteries = readBatterySelections(selectionSource, batteries, warnings);
  const economics = normalizeEconomics(project, economicsRecord, warnings);
  const finance = readProjectFinance(project, economicsRecord, economics, warnings);
  const loadProfile = readLoadProfile(load, hourlyClass, warnings);
  const sunResults = readSunDaddyResults(root.sunddaddy_results, warnings);

  return {
    schema_version: schema,
    project_id: projectId,
    project_name: projectName,
    warnings: dedupe(warnings),
    load_kwh: hourlyLoad,
    load_hourly_source: hourlyLoad ? hourlySource : null,
    monthly_kwh: monthly,
    billed_peak_kw: billed,
    solar_kwh: solarSum,
    solar_series: solarSeries,
    pre_rate: preRate,
    post_rates: postRates,
    batteries,
    selected_batteries: selectedBatteries,
    economics,
    finance,
    sunddaddy_results: sunResults,
    load_profile: loadProfile,
    units: root.units ?? null,
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
    if (!record) {
      warnings.push("A project list entry was not an object and was skipped.");
      continue;
    }
    const rawId = record.id ?? record.project_id;
    const id = readId(record.id) ?? readId(record.project_id);
    const name =
      readString(record.name) ?? readString(record.title) ?? readString(record.project_name) ?? readString(record.label) ?? id;
    if (!id || !name) {
      warnings.push(skippedIdWarning(rawId, "project list entry"));
      continue;
    }
    const project: ProjectListItem = { id, name };
    const customerId = readId(record.customer_id);
    const customerName = readString(record.customer_name);
    const label = readString(record.label);
    const projectType = readString(record.project_type) ?? readString(record.type);
    const status = readString(record.status);
    const siteAddress = readString(record.site_address);
    const utility = readString(record.utility) ?? readString(record.utility_name);
    const updatedAt = readString(record.updated_at);
    const systemSize = readOptionalNumber(record.system_size_kw ?? record.system_size);
    if (customerId) project.customer_id = customerId;
    if (customerName) project.customer_name = customerName;
    if (label) project.label = label;
    if (projectType) project.project_type = projectType;
    if (status) project.status = status;
    if (siteAddress) project.site_address = siteAddress;
    if (utility) project.utility = utility;
    if (updatedAt) project.updated_at = updatedAt;
    if (systemSize != null) project.system_size_kw = systemSize;
    projects.push(project);
  }
  if (list.length > 0 && projects.length === 0 && warnings.length === 0) {
    warnings.push("The Sun Daddy project list had entries, but none included a string or number id.");
  }
  return { projects, warnings: dedupe(warnings) };
}

export function normalizeRatePair(rateBody: unknown, nemBody: unknown, label: string): NormalizedRate {
  const warnings: WarningBag = [];
  const identity = rateIdentity(rateBody);
  if (!asRecord(rateBody) && !asRecord(nemBody)) {
    return { rate: null, warnings: [`${label} was missing.`], ...identity, ...rateExtras(rateBody, nemBody) };
  }
  const built = rateBody ? buildRateModel(rateBody, warnings) : null;
  const model = applyExportCredit(built ?? emptyRate(label), rateBody, nemBody, warnings);
  return { rate: model, warnings: dedupe(warnings), ...identity, ...rateExtras(rateBody, nemBody) };
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
  const id = readId(columns.id) ?? readId(rate.id) ?? readId(columns.rate_id) ?? readId(rate.rate_id) ?? undefined;

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

  let minimumFixed = 0;

  args.components.forEach((entry, index) => {
    const component = asRecord(entry);
    if (!component) {
      incomplete = true;
      args.warnings.push(`Component ${index + 1} was not an object and was skipped.`);
      return;
    }
    const kindRaw = readString(component.kind);
    const kind = kindRaw?.toLowerCase() ?? null;
    const componentName = readString(component.name) ?? readString(component.label) ?? `${kind ?? "component"} ${index + 1}`;
    if (kind === "percent") {
      incomplete = true;
      args.warnings.push(`${componentName} is a percent component and was not priced.`);
      return;
    }
    if (kind !== "energy" && kind !== "import_kwh" && kind !== "demand" && kind !== "fixed") {
      incomplete = true;
      args.warnings.push(`${componentName} has unsupported kind ${kindRaw ?? "(missing)"} and was skipped.`);
      return;
    }
    const valueTypeRaw = readString(component.value_type);
    const valueType = valueTypeRaw?.toLowerCase() ?? null;
    if (valueType && !KNOWN_VALUE_TYPES.has(valueType)) {
      incomplete = true;
      args.warnings.push(`${componentName} has unsupported value_type ${valueTypeRaw} and was skipped.`);
      return;
    }
    if (valueType === "tiered" || nonEmptyPeriods(component.tiers) || nonEmptyPeriods(component.tiered_periods)) {
      incomplete = true;
      args.warnings.push(`${componentName} is tiered and was not priced.`);
      return;
    }
    const amount = readRateAmount(component);
    if (amount == null) {
      incomplete = true;
      args.warnings.push(`${componentName} had no numeric rate and was skipped.`);
      return;
    }
    const target = readString(component.target)?.toLowerCase() ?? null;
    if (!targetAllowed(kind, target)) {
      incomplete = true;
      args.warnings.push(`${componentName} has target ${target ?? "(missing)"} and was skipped.`);
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
      // A minimum fixed charge is still billed every month. It also floors the bill
      // so export credits cannot reduce the month below that customer charge.
      if (component.is_minimum === true) minimumFixed += amount;
      return;
    }
    const masks = masksForValueType(valueType, scope, componentName, args.warnings);
    if (!masks) {
      incomplete = true;
      return;
    }
    if (kind === "demand") {
      demand.push({
        name: componentName,
        season_ids: scope.seasonIds,
        months: scope.months,
        weekday_hours: masks.weekday,
        weekend_hours: masks.weekend,
        demand_rate_kw: amount,
        is_facilities: component.is_facilities === true,
      });
      return;
    }
    const pricedAsExport = kind === "energy" && target === "export";
    energy.push({
      name: componentName,
      season_ids: scope.seasonIds,
      months: scope.months,
      weekday_hours: masks.weekday,
      weekend_hours: masks.weekend,
      energy_rate_kwh: pricedAsExport ? 0 : amount,
      ...(pricedAsExport ? { export_rate_kwh: amount } : {}),
    });
  });

  const columnFixed = readFinite(args.columns.fixed_monthly_charge);
  if (sawFixed && columnFixed != null && Math.abs(columnFixed - fixed) > 0.001) {
    incomplete = true;
    args.warnings.push("The schedule customer charge differs from the fixed components. The components were used.");
  }
  if (!sawFixed && columnFixed != null) fixed = columnFixed;

  const flags = billFlags(args.rate, args.columns, args.modelJson, args.warnings, () => {
    incomplete = true;
  });
  const minBill = minimumFixed > 0 ? Math.max(flags.min_bill_usd ?? 0, minimumFixed) : flags.min_bill_usd;
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
    ...(minBill != null ? { min_bill_usd: minBill } : {}),
    ...(flags.tax_rate != null ? { tax_rate: flags.tax_rate } : {}),
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

  const flags = billFlags(args.rate, args.columns, args.modelJson, args.warnings, () => {
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
    ...flags,
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
      noteNemLimits(nem, nemColumns, warnings);
      return { ...model, energy_periods: [...model.energy_periods, ...extraEnergy] };
    }
    if (credit) {
      if (credit.ambiguous) {
        warnings.push(TARIFF_INCOMPLETE);
        warnings.push("The NEM rate has more than one export credit field and none was applied.");
        noteNemLimits(nem, nemColumns, warnings);
        return model;
      }
      exportCredit = credit.value;
      noteNemLimits(nem, nemColumns, warnings);
      return { ...model, export_credit_kwh: exportCredit };
    }
    const seasonal = seasonalExportCredit(model, nem, nemColumns, warnings);
    if (seasonal) return seasonal;
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push(nemMissingCredit(nem, nemColumns));
    noteNemLimits(nem, nemColumns, warnings);
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

const KNOWN_VALUE_TYPES = new Set(["flat", "tou", "tiered", "seasonal"]);
/** Interval data in this model is already one hour, so these match hourly netting. */
const HOURLY_NETTING = new Set(["hourly", "interval", "intervals"]);
/** Credits applied in the month they occur, with no carry into the next month. */
const FORFEIT_ROLLOVER = new Set(["rollover_forfeit", "forfeit", "none", "no_rollover", "monthly"]);
/** Export credits offset energy, demand, and the fixed charge, which is what the bill does. */
const FULL_BILL_SCOPE = new Set(["full_bill", "full", "bill"]);

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
  const trueUp =
    presentValue(columns.true_up_month) ||
    presentValue(columns.true_up_day) ||
    columns.true_up != null ||
    rate.true_up != null ||
    (modelJson
      ? modelJson.true_up != null || presentValue(modelJson.true_up_month) || presentValue(modelJson.true_up_day)
      : false);
  if (trueUp) {
    mark();
    warnings.push("Annual true-up is not modeled. Export credits are applied in the month they occur.");
  }
  const netting = modelJson ? readString(modelJson.netting)?.toLowerCase() : null;
  if (netting && !HOURLY_NETTING.has(netting)) {
    mark();
    warnings.push(`This tariff's netting is ${netting}. The bill is still netted each hour.`);
  }
  const rollover = modelJson ? readString(modelJson.credit_rollover)?.toLowerCase() : null;
  if (rollover && !FORFEIT_ROLLOVER.has(rollover)) {
    mark();
    warnings.push(`Credit rollover ${rollover} is not modeled. Export credits stay in the month they occur.`);
  }
  const creditScope = modelJson ? readString(modelJson.export_credit_scope)?.toLowerCase() : null;
  if (creditScope && !FULL_BILL_SCOPE.has(creditScope)) {
    mark();
    warnings.push(`Export credits are applied to the full bill. This tariff's export credit scope is ${creditScope}.`);
  }
  const minBill = modelJson ? readFinite(modelJson.min_bill) : null;
  if (minBill != null && minBill < 0) {
    mark();
    warnings.push("A negative minimum bill was ignored.");
  }
}

function billFlags(
  rate: Record<string, unknown>,
  columns: Record<string, unknown>,
  modelJson: Record<string, unknown> | null,
  warnings: WarningBag,
  mark: () => void,
): Pick<RateModel, "min_bill_usd" | "tax_rate"> {
  noteScheduleLimits(rate, columns, modelJson, warnings, mark);
  const minBill = modelJson ? readFinite(modelJson.min_bill) : null;
  const tax = resolveTaxRate(columns, modelJson, warnings, mark);
  return {
    ...(minBill != null && minBill >= 0 ? { min_bill_usd: minBill } : {}),
    ...(tax != null ? { tax_rate: tax } : {}),
  };
}

/**
 * Sun Daddy stores tax_rate as either a fraction or a percent.
 * 0 is unused. (0, 1) is a fraction. (1, 100] is a percent. 1 is ambiguous.
 */
function resolveTaxRate(
  columns: Record<string, unknown>,
  modelJson: Record<string, unknown> | null,
  warnings: WarningBag,
  mark: () => void,
): number | undefined {
  const modelRaw = modelJson ? modelJson.tax_rate : undefined;
  const columnRaw = columns.tax_rate;
  const modelNum = readFinite(modelRaw);
  const columnNum = readFinite(columnRaw);
  if ((modelRaw != null && modelNum == null) || (columnRaw != null && columnNum == null && modelNum == null)) {
    mark();
    warnings.push("A tax rate was present and was not applied, because it was not a number.");
  }
  if (modelNum != null && columnNum != null && modelNum !== 0 && columnNum !== 0 && Math.abs(modelNum - columnNum) > 1e-9) {
    mark();
    warnings.push("The schedule tax rate differs from model_json. The model_json tax was used.");
  }
  const chosen = modelNum != null && modelNum !== 0 ? modelNum : columnNum != null && columnNum !== 0 ? columnNum : null;
  if (chosen == null) return undefined;
  if (chosen < 0 || chosen > 100) {
    mark();
    warnings.push("A tax rate was present and was not applied, because it is outside 0–100%.");
    return undefined;
  }
  if (chosen === 1) {
    mark();
    warnings.push("A tax rate was present and was not applied, because it is not clear if it is a percent or a fraction.");
    return undefined;
  }
  if (chosen > 0 && chosen < 1) return chosen;
  return chosen / 100;
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
    const id = readId(season.id) ?? `season-${index + 1}`;
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
  const seasonIds = readIdList(component.season_ids);
  if (Array.isArray(component.season_ids) && component.season_ids.length > 0 && !seasonIds) {
    warnings.push(`${name} had season ids that were not strings or numbers and was skipped.`);
    return "bad";
  }
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

function targetAllowed(kind: string, target: string | null): boolean {
  if (target == null || target === "import") return true;
  return kind === "energy" && target === "export";
}

/** Flat rates apply every hour. A mask is required only when the component is not flat. */
function masksForValueType(
  valueType: string | null,
  scope: { seasonal: boolean; masks: { weekday: HourMask; weekend: HourMask } | null },
  name: string,
  warnings: WarningBag,
): { weekday: HourMask; weekend: HourMask } | null {
  if (scope.masks) return scope.masks;
  if (valueType === "flat") return { weekday: ALL_HOURS, weekend: ALL_HOURS };
  if (valueType === "seasonal") {
    if (scope.seasonal) return { weekday: ALL_HOURS, weekend: ALL_HOURS };
    warnings.push(`${name} is seasonal but has no season or month and was skipped.`);
    return null;
  }
  warnings.push(`${name} had no 24-hour weekday/weekend mask and was skipped.`);
  return null;
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
  const load = asRecord(root.load);
  const profiles = Array.isArray(load?.profiles) ? load.profiles : [];
  const first = asRecord(profiles[0]);
  const profileRate = first ? asRecord(first.pre_rate) : null;
  const rates = asRecord(root.rates);
  const pre = asRecord(rates?.pre);
  if (pre && (pre.rate != null || pre.nem_rate != null)) {
    return { rate: mergeRateIdentity(pre.rate, profileRate), nem: pre.nem_rate };
  }
  if (first && (first.pre_rate != null || first.nem_rate != null)) {
    warnings.push("rates.pre was missing. The first load profile's rate was used.");
    return { rate: first.pre_rate, nem: first.nem_rate };
  }
  return { rate: null, nem: null };
}

function rateIdentity(rateBody: unknown): { utility: string | null; state: string | null } {
  const rate = asRecord(rateBody);
  if (!rate) return { utility: null, state: null };
  const columns = asRecord(rate.rate_schedules) ?? rate;
  return {
    utility:
      readString(columns.utility) ??
      readString(rate.utility) ??
      readString(columns.utility_name) ??
      readString(rate.utility_name),
    state: readString(columns.state) ?? readString(rate.state),
  };
}

/** Copy utility, state, and name from the load profile when the priced rate omits them. */
function mergeRateIdentity(rateBody: unknown, fallback: Record<string, unknown> | null): unknown {
  const rate = asRecord(rateBody);
  if (!rate || !fallback) return rateBody;
  const columns = asRecord(rate.rate_schedules);
  const hasUtility = readString(rate.utility) ?? (columns ? readString(columns.utility) : null);
  const hasState = readString(rate.state) ?? (columns ? readString(columns.state) : null);
  const hasName = readString(rate.name) ?? (columns ? readString(columns.name) : null);
  if (hasUtility && hasState && hasName) return rateBody;
  return {
    ...rate,
    ...(hasUtility ? {} : fallback.utility != null ? { utility: fallback.utility } : {}),
    ...(hasState ? {} : fallback.state != null ? { state: fallback.state } : {}),
    ...(hasName ? {} : fallback.name != null ? { name: fallback.name } : {}),
  };
}

function readPostRates(value: unknown): NormalizedRate[] {
  const rates = asRecord(value);
  const post = rates?.post;
  if (!Array.isArray(post)) return [];
  return post.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      return {
        rate: null,
        warnings: [`Post rate ${index + 1} was not an object.`],
        utility: null,
        state: null,
        ...rateExtras(null, null),
      };
    }
    return normalizeRatePair(record.rate, record.nem_rate, `Post rate ${index + 1}`);
  });
}

function normalizeEconomics(
  project: Record<string, unknown>,
  economics: Record<string, unknown> | null,
  warnings: WarningBag,
): NormalizedEconomics {
  return {
    discount_rate: percentField(prefer(project, economics, "discount_rate"), "discount_rate", warnings),
    rate_escalator: percentField(prefer(project, economics, "rate_escalator"), "rate_escalator", warnings),
    federal_tax_rate: percentField(prefer(project, economics, "federal_tax_rate"), "federal_tax_rate", warnings),
    state_tax_rate: percentField(prefer(project, economics, "state_tax_rate"), "state_tax_rate", warnings),
    analysis_period: integerField(prefer(project, economics, "analysis_period"), "analysis_period", warnings),
    system_size_kw: readFinite(prefer(project, economics, "system_size_kw")),
  };
}

/** Project-level value when it is set, otherwise the nested economics value. Null does not override. */
function prefer(project: Record<string, unknown>, economics: Record<string, unknown> | null, key: string): unknown {
  if (project[key] != null) return project[key];
  return economics ? economics[key] : undefined;
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
    const name = readString(record.name) ?? readString(record.model) ?? readId(record.id);
    if (usable == null || charge == null || discharge == null || cost == null || !name || !(usable > 0)) {
      warnings.push(`Battery ${name ?? "(unnamed)"} is missing capacity, power, or cost and was skipped.`);
      continue;
    }
    const additional = readFinite(record.cost_per_additional_unit);
    const efficiency = resolveCatalogEfficiency(record, name, warnings);
    const degradation = resolveCatalogDegradation(record, name, warnings);
    const id = readId(record.id) ?? name;
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
      round_trip_efficiency: efficiency.fraction,
      efficiency_source: efficiency.source,
      round_trip_efficiency_pct: efficiency.pct,
      degradation_per_year: degradation.fraction ?? undefined,
      degradation_source: degradation.source,
      degradation_pct_per_year: degradation.pct,
      warranty_years: readOptionalSpec(record.warranty_years, name, "warranty_years", warnings),
      warranty_throughput_kwh: readOptionalSpec(record.warranty_throughput_kwh, name, "warranty_throughput_kwh", warnings),
      min_reserve_pct: readReserve(record.min_reserve_pct, name, warnings),
      backup_capable: readBool(record.backup_capable),
      continuous_kw: readOptionalSpec(record.continuous_kw, name, "continuous_kw", warnings),
      peak_kw: readOptionalSpec(record.peak_kw, name, "peak_kw", warnings),
      voltage: readOptionalSpec(record.voltage, name, "voltage", warnings),
      phases: readPhases(record.phases),
      coupling: readString(record.coupling),
      dimensions_json: record.dimensions_json ?? null,
      weight_kg: readOptionalSpec(record.weight_kg, name, "weight_kg", warnings),
      indoor_outdoor: readString(record.indoor_outdoor),
      max_units_per_system: readMaxUnits(record.max_units_per_system, name, warnings),
      datasheet_url: readString(record.datasheet_url),
      lead_time_weeks: readOptionalSpec(record.lead_time_weeks, name, "lead_time_weeks", warnings),
      cost_breakdown_json: record.cost_breakdown_json ?? null,
    });
  }
  return batteries;
}

/**
 * round_trip_efficiency_pct wins (90 means 90%).
 * A null percent and a null legacy field stay at 0.90.
 * A legacy value above 1 is a percent, because Sun Daddy copies the percent into that field.
 * A legacy value from 0 to 1 stays a fraction so older rows keep working.
 */
function resolveCatalogEfficiency(
  record: Record<string, unknown>,
  name: string,
  warnings: WarningBag,
): { fraction: number; source: "spec" | "default"; pct: number | null } {
  if (record.round_trip_efficiency_pct != null) {
    const pct = readFinite(record.round_trip_efficiency_pct);
    if (pct != null && pct > 0 && pct <= 100) return { fraction: pct / 100, source: "spec", pct };
    warnings.push(`${name} has a round_trip_efficiency_pct outside 0–100. The 90% default was used.`);
    return { fraction: DEFAULT_ROUND_TRIP_EFFICIENCY, source: "default", pct: null };
  }
  if (record.round_trip_efficiency == null) {
    return { fraction: DEFAULT_ROUND_TRIP_EFFICIENCY, source: "default", pct: null };
  }
  const legacy = readFinite(record.round_trip_efficiency);
  if (legacy == null) {
    warnings.push(`${name} has a non-numeric round-trip efficiency. The 90% default was used.`);
    return { fraction: DEFAULT_ROUND_TRIP_EFFICIENCY, source: "default", pct: null };
  }
  // Older rows stored a fraction. The wizard still uses its assumption field for those,
  // which is what it did before a catalog percent existed. A value above 1 is the percent Sun Daddy copies in.
  if (legacy > 0 && legacy <= 1) return { fraction: legacy, source: "default", pct: null };
  if (legacy > 1 && legacy <= 100) return { fraction: legacy / 100, source: "spec", pct: legacy };
  warnings.push(`${name} has a round-trip efficiency outside 0–100%. The 90% default was used.`);
  return { fraction: DEFAULT_ROUND_TRIP_EFFICIENCY, source: "default", pct: null };
}

function resolveCatalogDegradation(
  record: Record<string, unknown>,
  name: string,
  warnings: WarningBag,
): { fraction: number | null; source: "spec" | "default"; pct: number | null } {
  if (record.degradation_pct_per_year == null) return { fraction: null, source: "default", pct: null };
  const pct = readFinite(record.degradation_pct_per_year);
  if (pct != null && pct >= 0 && pct < 100) return { fraction: pct / 100, source: "spec", pct };
  warnings.push(`${name} has a degradation_pct_per_year outside 0–100. The 2% assumption will be used.`);
  return { fraction: null, source: "default", pct: null };
}

function readReserve(value: unknown, name: string, warnings: WarningBag): number | null {
  if (value == null) return null;
  const pct = readFinite(value);
  if (pct == null || pct < 0 || pct >= 100) {
    warnings.push(`${name} has a min_reserve_pct outside 0–100 and it was not applied.`);
    return null;
  }
  return pct;
}

function readOptionalSpec(value: unknown, name: string, label: string, warnings: WarningBag): number | null {
  if (value == null) return null;
  const numeric = readFinite(value);
  if (numeric == null) {
    warnings.push(`${name} has a non-numeric ${label} and it was left blank.`);
    return null;
  }
  return numeric;
}

function readMaxUnits(value: unknown, name: string, warnings: WarningBag): number | null {
  if (value == null) return null;
  const numeric = readFinite(value);
  if (numeric == null || !Number.isInteger(numeric) || numeric < 1) {
    warnings.push(`${name} has a max_units_per_system that is not a whole number of 1 or more and it was left blank.`);
    return null;
  }
  return numeric;
}

function readPhases(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return readString(value);
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

function classifyHourlySource(value: unknown): { legacy: LoadHourlySource | null; kind: HourlySourceKind; raw: string | null } {
  const raw = readString(value);
  if (!raw) return { legacy: null, kind: "unknown", raw: null };
  const token = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (token === "measured" || token === "measured_hourly" || token === "meter" || token === "interval" || token === "fact") {
    return { legacy: "measured", kind: "measured", raw };
  }
  if (token === "synthesized_from_bills" || token === "building_type_shape" || token === "building_type") {
    if (token === "building_type" || token === "building_type_shape") {
      return { legacy: null, kind: "building_type_shape", raw };
    }
    return { legacy: "estimated", kind: "synthesized_from_bills", raw };
  }
  if (
    token === "estimated" ||
    token === "estimated_from_bills" ||
    token === "from_bills" ||
    token === "bills" ||
    token === "monthly" ||
    token === "bill"
  ) {
    return { legacy: "estimated", kind: "synthesized_from_bills", raw };
  }
  return { legacy: null, kind: "unknown", raw };
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
      id: readId(record.id) ?? `season-${seasons.length + 1}`,
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

function presentValue(value: unknown): boolean {
  return value != null && value !== "";
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

function readIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const id = readId(entry);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/** Sun Daddy ids are integers in the live export and strings in older fixtures. */
function readId(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function skippedIdWarning(value: unknown, label: string): string {
  if (value == null || (typeof value === "string" && value.trim().length === 0)) {
    return `A ${label} had no id and was skipped.`;
  }
  const type = Array.isArray(value) ? "array" : typeof value;
  return `A ${label} had an id of type ${type}, which is not a string or number, and was skipped.`;
}

function readBatterySelections(value: unknown, batteries: readonly Battery[], warnings: WarningBag): SelectedBattery[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("Project battery selections were not an array and were skipped.");
    return [];
  }
  const known = new Set(batteries.map((battery) => battery.id));
  const selected: SelectedBattery[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      warnings.push("A project battery selection was not an object and was skipped.");
      continue;
    }
    const id = readId(record.battery_id) ?? readId(record.id);
    if (!id) {
      warnings.push(skippedIdWarning(record.battery_id ?? record.id, "project battery selection"));
      continue;
    }
    if (known.size > 0 && !known.has(id)) {
      warnings.push(`Project battery ${id} was not in the battery list.`);
    }
    let quantity: number | null = null;
    if (record.quantity != null) {
      const parsed = readFinite(record.quantity);
      if (parsed == null || !Number.isInteger(parsed) || parsed < 1) {
        warnings.push(`Project battery ${id} has a quantity that is not a whole number of 1 or more.`);
      } else {
        quantity = parsed;
      }
    }
    const chargeSource = readString(record.charge_source);
    selected.push(chargeSource ? { battery_id: id, quantity, charge_source: chargeSource } : { battery_id: id, quantity });
  }
  return selected;
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

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function rateExtras(rateBody: unknown, nemBody: unknown): Pick<NormalizedRate, "verification" | "nem"> {
  return { verification: readVerification(rateBody), nem: readNemInfo(nemBody) };
}

function readVerification(rateBody: unknown): RateVerification {
  const rate = asRecord(rateBody);
  if (!rate) return { source_url: null, last_verified_at: null, effective_date: null, verified_by: null };
  const columns = asRecord(rate.rate_schedules) ?? rate;
  const model = asRecord(rate.model_json) ?? asRecord(columns.model_json);
  return {
    source_url: readString(columns.source_url) ?? readString(rate.source_url) ?? readString(model?.source_url),
    last_verified_at: readString(columns.last_verified_at) ?? readString(rate.last_verified_at) ?? readString(model?.last_verified_at),
    effective_date: readString(columns.effective_date) ?? readString(rate.effective_date) ?? readString(model?.effective_date),
    verified_by: readString(columns.verified_by) ?? readString(rate.verified_by) ?? readString(model?.verified_by),
  };
}

function readNemInfo(nemBody: unknown): NemScheduleInfo | null {
  const nem = asRecord(nemBody);
  if (!nem) return null;
  const columns = asRecord(nem.rate_schedules) ?? nem;
  const model = asRecord(nem.model_json) ?? asRecord(columns.model_json);
  return {
    id: readId(nem.id) ?? readId(columns.id),
    name: readString(nem.name) ?? readString(columns.name),
    is_nem_schedule: readBool(nem.is_nem_schedule) ?? readBool(columns.is_nem_schedule),
    nem_type: readString(nem.nem_type) ?? readString(columns.nem_type),
    export_credit_enabled: readBool(nem.export_credit_enabled) ?? readBool(columns.export_credit_enabled),
    export_credit_summer_kwh: readFinite(nem.export_credit_summer_kwh) ?? readFinite(columns.export_credit_summer_kwh),
    export_credit_winter_kwh: readFinite(nem.export_credit_winter_kwh) ?? readFinite(columns.export_credit_winter_kwh),
    netting: readString(nem.netting) ?? readString(columns.netting) ?? readString(model?.netting),
    export_credit_scope:
      readString(nem.export_credit_scope) ?? readString(columns.export_credit_scope) ?? readString(model?.export_credit_scope),
    export_credit_basis:
      readString(nem.export_credit_basis) ?? readString(columns.export_credit_basis) ?? readString(model?.export_credit_basis),
  };
}

function nemLabel(nem: Record<string, unknown>, columns: Record<string, unknown> | null): string {
  const name = readString(nem.name) ?? (columns ? readString(columns.name) : null) ?? "The linked NEM rate";
  const id = readId(nem.id) ?? (columns ? readId(columns.id) : null);
  return id ? `${name} (rate ${id})` : name;
}

function nemMissingCredit(nem: Record<string, unknown>, columns: Record<string, unknown> | null): string {
  return `${nemLabel(nem, columns)} has no export credit in Sun Daddy. No retail export credit was filled in, so none is assumed. Exports are treated as $0 in this bill.`;
}

/** Summer/winter credits, or a data-gap warning when export credits are explicitly off. Null when neither applies. */
function seasonalExportCredit(
  model: RateModel,
  nem: Record<string, unknown>,
  columns: Record<string, unknown> | null,
  warnings: WarningBag,
): RateModel | null {
  const enabled = readBool(nem.export_credit_enabled) ?? (columns ? readBool(columns.export_credit_enabled) : null);
  if (enabled === false) {
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push(
      `${nemLabel(nem, columns)} has export credits turned off in Sun Daddy. That is a data gap in the catalog, not a confirmed $0 credit. Exports are treated as $0 in this bill.`,
    );
    noteNemLimits(nem, columns, warnings);
    return model;
  }
  const summer = readFinite(nem.export_credit_summer_kwh) ?? (columns ? readFinite(columns.export_credit_summer_kwh) : null);
  const winter = readFinite(nem.export_credit_winter_kwh) ?? (columns ? readFinite(columns.export_credit_winter_kwh) : null);
  if (summer == null && winter == null) return null;
  if (summer != null && winter != null && Math.abs(summer - winter) > 1e-9) {
    warnings.push(TARIFF_INCOMPLETE);
    warnings.push(
      `${nemLabel(nem, columns)} lists different summer and winter export credits. This model has one export price, so exports are treated as $0 rather than an average.`,
    );
    noteNemLimits(nem, columns, warnings);
    return model;
  }
  noteNemLimits(nem, columns, warnings);
  return { ...model, export_credit_kwh: summer ?? winter ?? 0 };
}

function noteNemLimits(
  nem: Record<string, unknown>,
  columns: Record<string, unknown> | null,
  warnings: WarningBag,
): void {
  const model = asRecord(nem.model_json) ?? (columns ? asRecord(columns.model_json) : null);
  const netting =
    readString(nem.netting) ?? (columns ? readString(columns.netting) : null) ?? (model ? readString(model.netting) : null);
  if (netting && !HOURLY_NETTING.has(netting.toLowerCase())) {
    const line = `This tariff's netting is ${netting.toLowerCase()}. The bill is still netted each hour.`;
    if (!warnings.includes(line)) {
      if (!warnings.includes(TARIFF_INCOMPLETE)) warnings.unshift(TARIFF_INCOMPLETE);
      warnings.push(line);
    }
  }
  const scope =
    readString(nem.export_credit_scope) ??
    (columns ? readString(columns.export_credit_scope) : null) ??
    (model ? readString(model.export_credit_scope) : null);
  if (scope && !FULL_BILL_SCOPE.has(scope.toLowerCase())) {
    const line = `Export credits are applied to the full bill. This tariff's export credit scope is ${scope.toLowerCase()}.`;
    if (!warnings.includes(line)) {
      if (!warnings.includes(TARIFF_INCOMPLETE)) warnings.unshift(TARIFF_INCOMPLETE);
      warnings.push(line);
    }
  }
  const basis =
    readString(nem.export_credit_basis) ??
    (columns ? readString(columns.export_credit_basis) : null) ??
    (model ? readString(model.export_credit_basis) : null);
  if (basis) {
    const line = `Export credit basis is ${basis}. That hint is not modeled.`;
    if (!warnings.includes(line)) warnings.push(line);
  }
}

function readProjectFinance(
  project: Record<string, unknown>,
  economics: Record<string, unknown> | null,
  normalized: NormalizedEconomics,
  warnings: WarningBag,
): ProjectFinance {
  const addersRaw = prefer(project, economics, "itc_adders");
  const incentives = readIncentives(prefer(project, economics, "incentives"), warnings);
  const costAdders = prefer(project, economics, "cost_adders");
  return {
    itc_pct: percentField(prefer(project, economics, "itc_pct"), "itc_pct", warnings),
    itc_adders: readItcAdders(addersRaw, warnings),
    critical_load_pct: percentField(prefer(project, economics, "critical_load_pct"), "critical_load_pct", warnings),
    backup_hours_target: readHoursTarget(prefer(project, economics, "backup_hours_target"), warnings),
    use_macrs: readBool(prefer(project, economics, "use_macrs")),
    federal_tax_rate: normalized.federal_tax_rate,
    state_tax_rate: normalized.state_tax_rate,
    battery_equipment_cost: readFinite(prefer(project, economics, "battery_equipment_cost")),
    cost_adders_present: Array.isArray(costAdders) && costAdders.length > 0,
    incentives,
  };
}

function readItcAdders(value: unknown, warnings: WarningBag): number | null {
  if (value == null) return null;
  const percents: number[] = [];
  const take = (entry: unknown) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      percents.push(entry);
      return;
    }
    const record = asRecord(entry);
    const amount = record ? readFinite(record.value) : null;
    if (amount != null) percents.push(amount);
  };
  if (Array.isArray(value)) value.forEach(take);
  else take(value);
  if (percents.length === 0) {
    warnings.push("itc_adders was present and was not a percent or a list of percents.");
    return null;
  }
  return percents.reduce((sum, entry) => sum + entry, 0) / 100;
}

function readHoursTarget(value: unknown, warnings: WarningBag): number | null {
  if (value == null) return null;
  const hours = readFinite(value);
  if (hours == null || !(hours > 0)) {
    warnings.push("backup_hours_target was not a positive number and was left blank.");
    return null;
  }
  return hours;
}

function readIncentives(value: unknown, warnings: WarningBag): ProjectIncentive[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("Project incentives were not an array and were skipped.");
    return [];
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return {
        incentive_name: null,
        incentive_type: null,
        value: null,
        cap_amount: null,
        applies_to: null,
        credit_level: null,
        applies_battery_ids: [],
        payout_timing: null,
        spread_years: null,
      };
    }
    return {
      incentive_name: readString(record.incentive_name),
      incentive_type: readString(record.incentive_type),
      value: readFinite(record.value),
      cap_amount: record.cap_amount == null ? null : readFinite(record.cap_amount),
      applies_to: readString(record.applies_to),
      credit_level: readString(record.credit_level),
      applies_battery_ids: readIdList(record.applies_battery_ids) ?? [],
      payout_timing: readString(record.payout_timing),
      spread_years: integerField(record.spread_years, "spread_years", warnings),
    };
  });
}

function readSunDaddyResults(value: unknown, warnings: WarningBag): SunDaddyResult[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("sunddaddy_results was not an array and was skipped.");
    return [];
  }
  return value.map((entry) => {
    const record = asRecord(entry);
    const bills = record ? asRecord(record.monthly_bills) : null;
    return {
      post_rate_id: record ? readId(record.post_rate_id) : null,
      dispatch_strategy: record ? readString(record.dispatch_strategy) : null,
      annual_savings: record ? readFinite(record.annual_savings) : null,
      payback_years: record ? readFinite(record.payback_years) : null,
      npv: record ? readFinite(record.npv) : null,
      irr: record ? readFinite(record.irr) : null,
      monthly_bills: bills
        ? { pre_usd: readNumberRow(bills.pre_usd), post_usd: readNumberRow(bills.post_usd) }
        : null,
      computed_at: record ? readString(record.computed_at) : null,
      stale: record ? readBool(record.stale) : null,
    };
  });
}

function readNumberRow(value: unknown): (number | null)[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => (entry == null ? null : readFinite(entry)));
}

function readLoadProfile(
  load: Record<string, unknown> | null,
  hourlyClass: { kind: HourlySourceKind; raw: string | null },
  warnings: WarningBag,
): LoadProfileMeta {
  const profile = firstProfileRecord(load);
  if (profile && Array.isArray(profile.warnings)) {
    for (const entry of profile.warnings) {
      const text = readString(entry);
      if (text) warnings.push(text);
    }
  }
  return {
    hourly_source: hourlyClass.raw,
    hourly_kind: hourlyClass.kind,
    monthly_source: profile ? readString(profile.monthly_source) : null,
    peaks_source: profile ? readString(profile.peaks_source) : null,
    warnings: profile && Array.isArray(profile.warnings) ? profile.warnings.filter((entry) => typeof entry === "string") : [],
    bill_segments: profile && profile.bill_segments != null ? profile.bill_segments : null,
    bill_check: profile ? readBillCheck(profile.bill_check) : null,
  };
}

function firstProfileRecord(load: Record<string, unknown> | null): Record<string, unknown> | null {
  const profiles = Array.isArray(load?.profiles) ? load.profiles : [];
  return asRecord(profiles[0]);
}

function readBillCheck(value: unknown): BillCheck | null {
  const record = asRecord(value);
  if (!record) return null;
  const statusRaw = readString(record.status)?.toLowerCase() ?? null;
  const status: BillCheckStatus | null =
    statusRaw === "ok" || statusRaw === "no_actuals" || statusRaw === "blocked" || statusRaw === "error" ? statusRaw : null;
  const gradeRaw = readString(record.grade)?.toUpperCase() ?? null;
  const grade: BillCheckGrade | null = gradeRaw === "A" || gradeRaw === "B" || gradeRaw === "C" || gradeRaw === "D" ? gradeRaw : null;
  const annual = asRecord(record.annual);
  return {
    status,
    blocked_reason: readString(record.blocked_reason),
    rate_id: readId(record.rate_id),
    rate_name: readString(record.rate_name),
    periods: readBillPeriods(record.periods),
    by_month: record.by_month ?? null,
    annual: annual
      ? {
          actual: readFinite(annual.actual),
          modeled: readFinite(annual.modeled),
          delta_pct: readFinite(annual.delta_pct),
        }
      : null,
    grade,
    other_info_usd: readFinite(record.other_info_usd),
    notes: readString(record.notes),
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((entry) => typeof entry === "string") : null,
  };
}

function readBillPeriods(value: unknown): BillCheck["periods"] {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      actual: record ? readFinite(record.actual) : null,
      modeled: record ? readFinite(record.modeled) : null,
      delta_usd: record ? readFinite(record.delta_usd) : null,
      delta_pct: record ? readFinite(record.delta_pct) : null,
    };
  });
}

function emptyEconomics(): NormalizedEconomics {
  return {
    discount_rate: null,
    rate_escalator: null,
    federal_tax_rate: null,
    state_tax_rate: null,
    analysis_period: null,
    system_size_kw: null,
  };
}

function emptyFinance(economics: NormalizedEconomics): ProjectFinance {
  return {
    itc_pct: null,
    itc_adders: null,
    critical_load_pct: null,
    backup_hours_target: null,
    use_macrs: null,
    federal_tax_rate: economics.federal_tax_rate,
    state_tax_rate: economics.state_tax_rate,
    battery_equipment_cost: null,
    cost_adders_present: false,
    incentives: [],
  };
}

function emptyProfile(): LoadProfileMeta {
  return {
    hourly_source: null,
    hourly_kind: "unknown",
    monthly_source: null,
    peaks_source: null,
    warnings: [],
    bill_segments: null,
    bill_check: null,
  };
}

function readBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (token === "true" || token === "yes") return true;
    if (token === "false" || token === "no") return false;
  }
  return null;
}

function emptyStudy(warnings: string[]): NormalizedStudy {
  return {
    schema_version: null,
    project_id: null,
    project_name: null,
    warnings,
    load_kwh: null,
    load_hourly_source: null,
    monthly_kwh: null,
    billed_peak_kw: new Array<number | null>(12).fill(null),
    solar_kwh: null,
    solar_series: [],
    pre_rate: { rate: null, warnings: [], utility: null, state: null, ...rateExtras(null, null) },
    post_rates: [],
    batteries: [],
    selected_batteries: [],
    economics: emptyEconomics(),
    finance: emptyFinance(emptyEconomics()),
    sunddaddy_results: [],
    load_profile: emptyProfile(),
    units: null,
  };
}
