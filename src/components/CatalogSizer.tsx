import { useEffect, useMemo, useRef, useState } from "react";
import { MODEL_ASSUMPTIONS } from "../dispatch/assumptions";
import {
  BACKUP_ASSUMPTIONS,
  formatBackupHeadline,
  formatBackupPowerLimit,
  type BackupEstimate,
  type BackupLoadMode,
  type BackupLoadShape,
  type BackupScenario,
} from "../dispatch/backup";
import { DAYS_IN_MONTH, HOURS_PER_YEAR, NO_HOURS, hoursBetween } from "../dispatch/calendar";
import {
  BACKUP_DURATION,
  CHEAPEST_PEAK_TARGET,
  RANKING_MODES,
  batteryMissesConstraint,
  bestQuantityForBattery,
  constraintMissLabel,
  rankCandidates,
  rankingMode,
  sweepBatteries,
  type CandidateMetrics,
  type RankContext,
  type RankingMode,
} from "../dispatch/rank";
import { parseBilledPeaks, parseHourlyNumbers } from "../dispatch/series-input";
import { simulateDispatch } from "../dispatch/simulate";
import { syntheticBatteries, syntheticExample } from "../dispatch/synthetic-example";
import type { Battery, DispatchStrategy, RateModel, SimulationResult } from "../dispatch/types";
import { normalizeBatteryCatalog, normalizeProjectList } from "../sun-daddy/normalize";
import type { NormalizedStudy, ProjectListItem, SelectedBattery } from "../sun-daddy/types";
import { InterconnectPanel } from "./InterconnectPanel";
import { formatUsd } from "../sizing/tariff";

type BatteryRow = {
  key: string;
  name: string;
  usable: string;
  charge: string;
  discharge: string;
  cost: string;
  extra: string;
  inProject: boolean;
};

type ProjectPick = {
  id: string;
  quantity: number | null;
};

type CatalogStatus =
  | { state: "loading" }
  | { state: "ready"; count: number }
  | { state: "placeholder"; notice: string };

const PLACEHOLDER_NOTICE = "These are placeholder batteries, not your Sun Daddy catalog.";
const MAX_UNITS = 48;

const STRATEGIES: { id: DispatchStrategy; label: string }[] = [
  { id: "combined", label: "Combined" },
  { id: "demand_peak_shave", label: "Demand peak shaving" },
  { id: "tou_arbitrage", label: "TOU arbitrage" },
  { id: "solar_self_consumption", label: "Solar self-consumption" },
];

const ROW_FIELDS = ["name", "usable", "charge", "discharge", "cost", "extra"] as const;

const example = syntheticExample();

function rowsFromBatteries(batteries: Battery[], picks: readonly ProjectPick[] = []): BatteryRow[] {
  const picked = new Set(picks.map((pick) => pick.id));
  return batteries.map((battery) => ({
    key: battery.id,
    name: battery.name,
    usable: String(battery.usable_capacity_kwh),
    charge: String(battery.max_charge_rate_kw),
    discharge: String(battery.max_discharge_rate_kw),
    cost: String(battery.cost_per_unit),
    extra: String(battery.cost_per_additional_unit ?? battery.cost_per_unit),
    inProject: picked.has(battery.id),
  }));
}

function readProjectPicks(selections: readonly SelectedBattery[] | undefined): ProjectPick[] {
  if (!Array.isArray(selections)) return [];
  const picks: ProjectPick[] = [];
  for (const entry of selections) {
    const raw = entry?.battery_id as unknown;
    const id =
      typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!id) continue;
    const quantity = Number.isInteger(entry.quantity) && (entry.quantity ?? 0) >= 1 ? entry.quantity : null;
    picks.push({ id, quantity });
  }
  return picks;
}

function includeQuantities(picks: readonly ProjectPick[]): Record<string, number[]> {
  const include: Record<string, number[]> = {};
  for (const pick of picks) {
    if (pick.quantity == null) continue;
    include[pick.id] = [pick.quantity];
  }
  return include;
}

function catalogSourceLabel(status: CatalogStatus, placeholderCount: number): string {
  if (status.state === "loading") return "Battery catalog: loading Sun Daddy…";
  if (status.state === "ready") return `Battery catalog: Sun Daddy (${countLabel(status.count)})`;
  return `Battery catalog: example placeholders (${countLabel(placeholderCount)})`;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "battery" : "batteries"}`;
}

function missingPickNote(picks: readonly ProjectPick[], ids: ReadonlySet<string>): string | null {
  const missing = picks.filter((pick) => !ids.has(pick.id));
  if (missing.length === 0) return null;
  const list = missing.map((pick) => pick.id).join(", ");
  return missing.length === 1
    ? `Selected battery ${list} is not in the loaded catalog.`
    : `Selected batteries ${list} are not in the loaded catalog.`;
}

function sameBatteryRows(current: readonly BatteryRow[], next: readonly BatteryRow[]): boolean {
  if (current.length !== next.length) return false;
  return current.every(
    (row, index) =>
      row.key === next[index]?.key &&
      row.name === next[index]?.name &&
      row.usable === next[index]?.usable &&
      row.charge === next[index]?.charge &&
      row.discharge === next[index]?.discharge &&
      row.cost === next[index]?.cost &&
      row.extra === next[index]?.extra &&
      row.inProject === next[index]?.inProject,
  );
}

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatUsd(value);
}

function years(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} yr`;
}

export default function CatalogSizer() {
  const [source, setSource] = useState<"example" | "manual">("example");
  const [loadKwh, setLoadKwh] = useState<number[]>(example.load_kwh);
  const [solarKwh, setSolarKwh] = useState<number[]>(example.solar_kwh);
  const [rate, setRate] = useState<RateModel>(example.rate);
  const [simpleRate, setSimpleRate] = useState(false);
  const [flatEnergy, setFlatEnergy] = useState("0.08");
  const [peakEnergy, setPeakEnergy] = useState("0.30");
  const [peakStart, setPeakStart] = useState("16");
  const [peakEnd, setPeakEnd] = useState("21");
  const [facilities, setFacilities] = useState("10");
  const [peakDemand, setPeakDemand] = useState("8");
  const [fixedCharge, setFixedCharge] = useState("50");
  const [exportCredit, setExportCredit] = useState("0.03");
  const [batteries, setBatteries] = useState<BatteryRow[]>(rowsFromBatteries(example.batteries));
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({ state: "loading" });
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [projectPicks, setProjectPicks] = useState<ProjectPick[]>([]);
  const [pickEpoch, setPickEpoch] = useState(0);
  const [strategy, setStrategy] = useState<DispatchStrategy>("combined");
  const [modeId, setModeId] = useState(RANKING_MODES[0].id);
  const [rte, setRte] = useState("90");
  const [degradation, setDegradation] = useState("2");
  const [socMin, setSocMin] = useState("0");
  const [socMax, setSocMax] = useState("100");
  const [discount, setDiscount] = useState("6");
  const [escalator, setEscalator] = useState("2");
  const [analysisYears, setAnalysisYears] = useState("25");
  const [maxQuantity, setMaxQuantity] = useState("24");
  const [criticalKw, setCriticalKw] = useState("25");
  const [backupHours, setBackupHours] = useState("4");
  const [backupMode, setBackupMode] = useState<BackupLoadMode>("backup_loads");
  const [backupShape, setBackupShape] = useState<BackupLoadShape>("percent_of_load");
  const [backupPercent, setBackupPercent] = useState("30");
  const [outageSoc, setOutageSoc] = useState("100");
  const [outageSolar, setOutageSolar] = useState(false);
  const [override, setOverride] = useState<{ batteryId: string; quantity: number } | null>(null);
  const [peakTarget, setPeakTarget] = useState("20");
  const [billedText, setBilledText] = useState("140");
  const [loadText, setLoadText] = useState("");
  const [solarText, setSolarText] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [query, setQuery] = useState("");
  const [sunMessage, setSunMessage] = useState<string | null>(null);
  const [studyWarnings, setStudyWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const catalogRequest = useRef(0);
  const projectPicksRef = useRef(projectPicks);
  const batteryRowsRef = useRef(batteries);
  const appliedPickEpoch = useRef(0);
  projectPicksRef.current = projectPicks;
  batteryRowsRef.current = batteries;

  const sweep = useMemo(() => {
    try {
      const activeRate = simpleRate
        ? buildSimpleRate({
            flatEnergy,
            peakEnergy,
            peakStart,
            peakEnd,
            facilities,
            peakDemand,
            fixedCharge,
            exportCredit,
          })
        : rate;
      const catalog = batteriesToCatalog(batteries, Number(rte) / 100, Number(degradation) / 100);
      const quantity = Number(maxQuantity);
      const min = Number(socMin) / 100;
      const max = Number(socMax) / 100;
      const yearsCount = Number(analysisYears);
      const discountRate = Number(discount) / 100;
      const rateEscalator = Number(escalator) / 100;
      const billed = parseBilledPeaks(billedText);
      const backup = backupScenarioFromInputs({
        backupMode,
        backupShape,
        backupPercent,
        criticalKw,
        outageSoc,
        outageSolar,
      });
      if (!(quantity >= 1) || !Number.isInteger(quantity) || quantity > MAX_UNITS) {
        return { ok: false as const, error: `Max units must be a whole number from 1 to ${MAX_UNITS}.` };
      }
      if (!(min >= 0) || !(max <= 1) || !(min < max)) {
        return { ok: false as const, error: "The state-of-charge window must sit between 0% and 100%, with the max above the min." };
      }
      const swept = sweepBatteries({
        load_kwh: loadKwh,
        solar_kwh: solarKwh,
        rate: activeRate,
        batteries: catalog,
        max_quantity: quantity,
        strategy,
        soc_min: min,
        soc_max: max,
        billed_peak_kw: billed ?? undefined,
        discount_rate: discountRate,
        rate_escalator: rateEscalator,
        analysis_years: yearsCount,
        backup,
        include_quantities: includeQuantities(projectPicks),
      });
      return {
        ok: true as const,
        swept,
        sim: {
          load_kwh: loadKwh,
          solar_kwh: solarKwh,
          rate: activeRate,
          strategy,
          soc_min: min,
          soc_max: max,
          billed_peak_kw: billed ?? undefined,
          backup,
        },
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not rank these batteries." };
    }
  }, [
    batteries,
    strategy,
    rte,
    degradation,
    socMin,
    socMax,
    discount,
    escalator,
    analysisYears,
    maxQuantity,
    criticalKw,
    backupMode,
    backupShape,
    backupPercent,
    outageSoc,
    outageSolar,
    billedText,
    loadKwh,
    solarKwh,
    rate,
    simpleRate,
    flatEnergy,
    peakEnergy,
    peakStart,
    peakEnd,
    facilities,
    peakDemand,
    fixedCharge,
    exportCredit,
    projectPicks,
  ]);

  const model = useMemo(() => {
    if (!sweep.ok) return sweep;
    try {
      const mode = rankingMode(modeId);
      const ctx = {
        target_peak_reduction_kw: Number(peakTarget),
        backup_target_hours: Number(backupHours),
      };
      const ranked = rankCandidates(sweep.swept, mode, ctx);
      return { ok: true as const, ranked, swept: sweep.swept, mode, ctx, sim: sweep.sim };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not rank these batteries." };
    }
  }, [sweep, modeId, peakTarget, backupHours]);

  const selection = model.ok ? resolveSelection(model.ranked, override) : null;
  const chartSeries = model.ok ? seriesByBattery(model.swept) : [];
  const buildingPeak = loadKwh.reduce((max, value) => Math.max(max, value), 0);
  const selected = selection?.selected ?? null;

  const detail = useMemo(() => {
    if (!model.ok || !selected) return null;
    try {
      return simulateDispatch({
        load_kwh: model.sim.load_kwh,
        solar_kwh: model.sim.solar_kwh,
        rate: model.sim.rate,
        battery: selected.battery,
        quantity: selected.quantity,
        strategy: model.sim.strategy,
        soc_min: model.sim.soc_min,
        soc_max: model.sim.soc_max,
        billed_peak_kw: model.sim.billed_peak_kw,
        include_hourly: true,
      });
    } catch {
      return null;
    }
  }, [model, selected]);

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (appliedPickEpoch.current === pickEpoch) return;
    if (!model.ok) return;
    if (projectPicks.length === 0) {
      appliedPickEpoch.current = pickEpoch;
      return;
    }
    if (catalogStatus.state === "loading") return;
    const pick = projectPicks.find((entry) => model.ranked.some((row) => row.battery.id === entry.id));
    if (!pick) {
      appliedPickEpoch.current = pickEpoch;
      return;
    }
    const exact =
      pick.quantity != null &&
      model.ranked.some((row) => row.battery.id === pick.id && row.quantity === pick.quantity);
    const quantity = exact
      ? pick.quantity ?? 1
      : bestQuantityForBattery(model.ranked, pick.id, model.mode, model.ctx);
    appliedPickEpoch.current = pickEpoch;
    setOverride({ batteryId: pick.id, quantity });
  }, [model, projectPicks, pickEpoch, catalogStatus]);

  useEffect(() => {
    if (!override || !model.ok) return;
    if (appliedPickEpoch.current !== pickEpoch) return;
    const alive = model.ranked.some(
      (row) => row.battery.id === override.batteryId && row.quantity === override.quantity,
    );
    if (!alive) setOverride(null);
  }, [model, override, pickEpoch]);

  async function loadCatalog() {
    const requestId = catalogRequest.current + 1;
    catalogRequest.current = requestId;
    setCatalogBusy(true);
    try {
      const response = await fetch("/api/sun-daddy/batteries");
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (requestId !== catalogRequest.current) return;
      if (!response.ok || body == null) {
        showPlaceholderCatalog();
        return;
      }
      const catalog = normalizeBatteryCatalog(body);
      if (catalog.batteries.length === 0) {
        showPlaceholderCatalog();
        return;
      }
      setBatteries(rowsFromBatteries(catalog.batteries, projectPicksRef.current));
      setCatalogStatus({ state: "ready", count: catalog.batteries.length });
      const note = missingPickNote(
        projectPicksRef.current,
        new Set(catalog.batteries.map((battery) => battery.id)),
      );
      if (note) {
        setStudyWarnings((current) => (current.includes(note) ? current : [...current, note]));
      }
    } catch {
      if (requestId !== catalogRequest.current) return;
      showPlaceholderCatalog();
    } finally {
      if (requestId === catalogRequest.current) setCatalogBusy(false);
    }
  }

  function showPlaceholderCatalog() {
    const next = rowsFromBatteries(syntheticBatteries(), projectPicksRef.current);
    setBatteries((current) => (sameBatteryRows(current, next) ? current : next));
    setCatalogStatus({ state: "placeholder", notice: PLACEHOLDER_NOTICE });
  }

  async function searchProjects() {
    setBusy(true);
    setSunMessage(null);
    try {
      const response = await fetch(`/api/sun-daddy/projects?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as {
        error?: string;
        projects?: unknown;
        warnings?: string[];
      };
      if (!response.ok) {
        setProjects([]);
        setSunMessage(body.error ?? "Sun Daddy isn't available. The synthetic example still runs on this screen.");
        return;
      }
      const listed = normalizeProjectList(Array.isArray(body.projects) ? body.projects : []);
      setProjects(listed.projects);
      const serverWarnings = Array.isArray(body.warnings) ? body.warnings : [];
      const warning =
        serverWarnings.find((entry) => typeof entry === "string" && entry.trim().length > 0) ?? listed.warnings[0];
      setSunMessage(warning ?? (listed.projects.length === 0 ? "No matching projects." : null));
    } catch {
      setProjects([]);
      setSunMessage("Sun Daddy isn't available from this session. Paste hourly CSVs or keep the synthetic example.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(id: string) {
    setBusy(true);
    setSunMessage(null);
    try {
      const response = await fetch(`/api/sun-daddy/project/${encodeURIComponent(id)}`);
      const body = (await response.json()) as { error?: string; normalized?: NormalizedStudy };
      if (!response.ok || !body.normalized) {
        setSunMessage(body.error ?? "That project could not be loaded.");
        return;
      }
      applyStudy(body.normalized);
    } catch {
      setSunMessage("Sun Daddy isn't available from this session.");
    } finally {
      setBusy(false);
    }
  }

  function applyStudy(study: NormalizedStudy) {
    const notes = [...study.warnings, ...study.pre_rate.warnings];
    if (study.load_kwh) setLoadKwh(study.load_kwh);
    else notes.push("This project has no complete 8,760-hour load, so the previous load was kept.");
    if (study.solar_kwh) setSolarKwh(study.solar_kwh);
    if (study.pre_rate.rate) {
      setRate(study.pre_rate.rate);
      setSimpleRate(false);
    }
    const picks = readProjectPicks(study.selected_batteries);
    if (catalogStatus.state !== "loading") {
      const note = missingPickNote(picks, new Set(batteryRowsRef.current.map((row) => row.key)));
      if (note) notes.push(note);
    }
    projectPicksRef.current = picks;
    setProjectPicks(picks);
    setBatteries((current) => current.map((row) => ({ ...row, inProject: picks.some((pick) => pick.id === row.key) })));
    setPickEpoch((epoch) => epoch + 1);
    if (study.economics.discount_rate != null) setDiscount(String(study.economics.discount_rate * 100));
    if (study.economics.rate_escalator != null) setEscalator(String(study.economics.rate_escalator * 100));
    if (study.economics.analysis_period != null) setAnalysisYears(String(study.economics.analysis_period));
    const peaks = study.billed_peak_kw.filter((peak) => peak != null);
    if (peaks.length === 12) setBilledText(study.billed_peak_kw.join(", "));
    setSource("manual");
    setStudyWarnings(notes);
    setSunMessage(study.project_name ? `Loaded ${study.project_name}.` : "Project loaded.");
  }

  function loadExample() {
    const fresh = syntheticExample();
    setLoadKwh(fresh.load_kwh);
    setSolarKwh(fresh.solar_kwh);
    setRate(fresh.rate);
    setSimpleRate(false);
    setBilledText("140");
    setSource("example");
    setStudyWarnings([]);
    setSunMessage(null);
    clearProjectMarks();
  }

  function clearProjectMarks() {
    projectPicksRef.current = [];
    setProjectPicks([]);
    setBatteries((current) => (current.some((row) => row.inProject) ? current.map((row) => ({ ...row, inProject: false })) : current));
    setOverride(null);
  }

  function readLoadFile(text: string) {
    try {
      setLoadKwh(parseHourlyNumbers(text));
      setSource("manual");
      setStudyWarnings([]);
    } catch (error) {
      setStudyWarnings([error instanceof Error ? error.message : "Could not read the load file."]);
    }
  }

  function readSolarFile(text: string) {
    try {
      setSolarKwh(parseHourlyNumbers(text));
      setSource("manual");
    } catch (error) {
      setStudyWarnings([error instanceof Error ? error.message : "Could not read the solar file."]);
    }
  }

  const rankingBest = selection?.top ?? null;
  const unmetPeak =
    model.ok &&
    modeId === CHEAPEST_PEAK_TARGET.id &&
    rankingBest != null &&
    rankingBest.peak_reduction_kw + 1e-6 < Number(peakTarget);
  const unmetBackup =
    model.ok &&
    modeId === BACKUP_DURATION.id &&
    rankingBest != null &&
    (rankingBest.backup_hours ?? 0) + 1e-9 < Number(backupHours);

  function chooseBattery(batteryId: string) {
    if (!model.ok) return;
    setOverride({
      batteryId,
      quantity: bestQuantityForBattery(model.ranked, batteryId, model.mode, model.ctx),
    });
  }

  function chooseQuantity(quantity: number) {
    if (!selected) return;
    setOverride({ batteryId: selected.battery.id, quantity });
  }

  return (
    <div className="wrap">
      <header className="mast">
        <div>
          <p className="kicker">Hourly dispatch · Utah, California, Nevada, Idaho</p>
          <h1>Battery Bench</h1>
          <p className="lede">
            Rank the catalog by bill savings, payback, lifetime value, solar self-consumption, a peak-kW target, or backup
            hours. The detail view starts on the best pick. Choose any other battery and quantity to hold that result
            while the ranking changes.
          </p>
        </div>
      </header>

      <div className="layout">
        <section className="panel" aria-labelledby="inputs-title">
          <div className="panel-head">
            <h2 id="inputs-title">Inputs</h2>
            <p>The synthetic building runs with no login. Battery options come from the Sun Daddy catalog when the worker can reach it.</p>
          </div>
          <div className="segmented" role="group" aria-label="Load source">
            <button type="button" aria-pressed={source === "example"} onClick={loadExample}>
              Synthetic example
            </button>
            <button type="button" aria-pressed={source === "manual"} onClick={() => setSource("manual")}>
              Manual
            </button>
          </div>
          <p className="note" data-testid="example-note">
            {rate.name ?? "Rate"} · {loadKwh.length === HOURS_PER_YEAR ? "8,760 load hours" : "load incomplete"} ·{" "}
            {solarKwh.some((value) => value > 0) ? "solar attached" : "no solar"}. Round-number example prices are not a
            utility tariff.
          </p>

          <div className="sun-box">
            <label>
              Sun Daddy project search
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or city" />
            </label>
            <button type="button" onClick={() => void searchProjects()} disabled={busy}>
              {busy ? "Loading…" : "Search Sun Daddy"}
            </button>
            {sunMessage ? (
              <p className="note">{sunMessage}</p>
            ) : (
              <p className="meta">
                If the export token is not on the worker, search returns a configuration message and this example stays usable.
              </p>
            )}
            {projects.length > 0 ? (
              <ul className="project-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button type="button" onClick={() => void openProject(project.id)}>
                      {project.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <fieldset className="presets">
            <legend>Manual hourly CSV</legend>
            <label>
              Load kWh, 8,760 values
              <textarea
                value={loadText}
                onChange={(event) => setLoadText(event.target.value)}
                rows={3}
                placeholder="Paste or leave blank to keep the current load"
              />
            </label>
            <button type="button" className="text-button" onClick={() => readLoadFile(loadText)}>
              Use pasted load
            </button>
            <label className="upload">
              Load CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(readLoadFile);
                  event.target.value = "";
                }}
              />
            </label>
            <label>
              Solar kWh, 8,760 values
              <textarea value={solarText} onChange={(event) => setSolarText(event.target.value)} rows={3} />
            </label>
            <button type="button" className="text-button" onClick={() => readSolarFile(solarText)}>
              Use pasted solar
            </button>
            {studyWarnings.length > 0 ? (
              <p className="warn-line" role="alert">
                {studyWarnings.join(" ")}
              </p>
            ) : null}
            <label className="upload">
              Solar CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(readSolarFile);
                  event.target.value = "";
                }}
              />
            </label>
          </fieldset>

          <label className="check">
            <input type="checkbox" checked={simpleRate} onChange={(event) => setSimpleRate(event.target.checked)} />
            Enter a simple rate instead of the loaded tariff
          </label>
          {simpleRate ? (
            <div className="form-grid">
              <label>
                Off-peak $/kWh
                <input value={flatEnergy} onChange={(event) => setFlatEnergy(event.target.value)} />
              </label>
              <label>
                On-peak $/kWh
                <input value={peakEnergy} onChange={(event) => setPeakEnergy(event.target.value)} />
              </label>
              <label>
                Peak start hour
                <input value={peakStart} onChange={(event) => setPeakStart(event.target.value)} />
              </label>
              <label>
                Peak end hour
                <input value={peakEnd} onChange={(event) => setPeakEnd(event.target.value)} />
              </label>
              <label>
                Facilities $/kW
                <input value={facilities} onChange={(event) => setFacilities(event.target.value)} />
              </label>
              <label>
                On-peak demand $/kW
                <input value={peakDemand} onChange={(event) => setPeakDemand(event.target.value)} />
              </label>
              <label>
                Fixed $/month
                <input value={fixedCharge} onChange={(event) => setFixedCharge(event.target.value)} />
              </label>
              <label>
                Export credit $/kWh
                <input value={exportCredit} onChange={(event) => setExportCredit(event.target.value)} />
              </label>
            </div>
          ) : null}

          <label>
            Strategy
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as DispatchStrategy)}>
              {STRATEGIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label>
              Round-trip efficiency (%)
              <input value={rte} onChange={(event) => setRte(event.target.value)} />
            </label>
            <label>
              Degradation (% / yr)
              <input value={degradation} onChange={(event) => setDegradation(event.target.value)} />
            </label>
            <label>
              SOC min (%)
              <input value={socMin} onChange={(event) => setSocMin(event.target.value)} />
            </label>
            <label>
              SOC max (%)
              <input value={socMax} onChange={(event) => setSocMax(event.target.value)} />
            </label>
            <label>
              Discount rate (%)
              <input value={discount} onChange={(event) => setDiscount(event.target.value)} />
            </label>
            <label>
              Rate escalator (%)
              <input value={escalator} onChange={(event) => setEscalator(event.target.value)} />
            </label>
            <label>
              Analysis years
              <input value={analysisYears} onChange={(event) => setAnalysisYears(event.target.value)} />
            </label>
            <label>
              Max units
              <input value={maxQuantity} onChange={(event) => setMaxQuantity(event.target.value)} />
            </label>
            <label>
              Backup target (h)
              <input value={backupHours} onChange={(event) => setBackupHours(event.target.value)} />
            </label>
            <label>
              Peak reduction target (kW)
              <input value={peakTarget} onChange={(event) => setPeakTarget(event.target.value)} />
            </label>
            <label>
              Billed peaks (kW)
              <input
                value={billedText}
                onChange={(event) => setBilledText(event.target.value)}
                placeholder="140 or Jan…Dec"
              />
            </label>
          </div>
          <p className="meta">
            One billed-peak number is repeated for every month. Twelve numbers are January through December. Blank uses
            the hourly peak. Max units is a ceiling: each battery is swept only across quantities that can matter for
            this site's peak, and the run stays capped so a small unit and a very large unit can share one catalog.
          </p>

          <fieldset className="presets">
            <legend>Backup duration</legend>
            <div className="segmented" role="group" aria-label="Outage load">
              <button
                type="button"
                aria-pressed={backupMode === "whole_building"}
                onClick={() => setBackupMode("whole_building")}
              >
                Whole building
              </button>
              <button
                type="button"
                aria-pressed={backupMode === "backup_loads"}
                onClick={() => setBackupMode("backup_loads")}
              >
                Backup loads
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Backup load shape">
              <button
                type="button"
                aria-pressed={backupShape === "percent_of_load"}
                onClick={() => setBackupShape("percent_of_load")}
              >
                Percent of load
              </button>
              <button type="button" aria-pressed={backupShape === "fixed_kw"} onClick={() => setBackupShape("fixed_kw")}>
                Fixed kW
              </button>
            </div>
            <div className="form-grid">
              <label>
                Percent of building load
                <input value={backupPercent} onChange={(event) => setBackupPercent(event.target.value)} />
              </label>
              <label>
                Fixed critical load (kW)
                <input value={criticalKw} onChange={(event) => setCriticalKw(event.target.value)} />
              </label>
              <label>
                Outage starting charge (%)
                <input value={outageSoc} onChange={(event) => setOutageSoc(event.target.value)} />
              </label>
            </div>
            <p className="meta">
              {backupMode === "whole_building"
                ? "Whole building uses the full hourly load. Percent and fixed kW apply when you switch to backup loads."
                : backupShape === "percent_of_load"
                  ? "Backup loads use this percent of each hour of the building load."
                  : "Backup loads use this fixed kW in every hour."}
            </p>
            <label className="check">
              <input type="checkbox" checked={outageSolar} onChange={(event) => setOutageSolar(event.target.checked)} />
              Include solar during outage (optimistic)
            </label>
            <p className="note">
              Grid-tied inverters shut down without islanding-capable equipment. Leave this off unless the site can island.
            </p>
          </fieldset>

          <div className="catalog-line">
            <p data-testid="catalog-source">{catalogSourceLabel(catalogStatus, batteries.length)}</p>
            <button type="button" onClick={() => void loadCatalog()} disabled={catalogBusy}>
              {catalogBusy ? "Loading…" : "Reload catalog"}
            </button>
          </div>
          {catalogStatus.state === "placeholder" ? (
            <p className="warn-line" role="status" data-testid="catalog-placeholder">
              {catalogStatus.notice}
            </p>
          ) : null}
          <div className="table-wrap">
            <table>
              <caption>Batteries</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>kWh</th>
                  <th>Charge</th>
                  <th>Discharge</th>
                  <th>First $</th>
                  <th>Next $</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {batteries.map((row) => (
                  <tr key={row.key}>
                    {ROW_FIELDS.map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${row.name} ${field}`}
                          value={row[field]}
                          onChange={(event) =>
                            setBatteries((current) =>
                              current.map((item) => (item.key === row.key ? { ...item, [field]: event.target.value } : item)),
                            )
                          }
                        />
                        {field === "name" && row.inProject ? <span className="in-project">In this project</span> : null}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setBatteries((current) => current.filter((item) => item.key !== row.key))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setBatteries((current) => [
                ...current,
                {
                  key: `custom-${current.length + 1}`,
                  name: "Custom",
                  usable: "100",
                  charge: "50",
                  discharge: "50",
                  cost: "40000",
                  extra: "30000",
                  inProject: false,
                },
              ])
            }
          >
            Add battery
          </button>
        </section>

        <section className="panel results" aria-labelledby="rank-title">
          <div className="panel-head">
            <h2 id="rank-title">Ranking</h2>
            <p data-testid="active-mode">{model.ok ? model.mode.label : "Ranking"}</p>
          </div>
          <div className="mode-grid" role="tablist" aria-label="Ranking mode">
            {RANKING_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={modeId === mode.id}
                onClick={() => setModeId(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {model.ok ? <p className="note">{model.mode.description}</p> : null}
          {unmetPeak ? (
            <p className="note">Nothing in the list hits the peak-kW target. The best row is the closest reduction.</p>
          ) : null}
          {unmetBackup ? (
            <p className="note">Nothing in the list covers the backup-hour target. The best row is the longest backup.</p>
          ) : null}
          {model.ok && selection && selected ? (
            <>
              <BatteryOverride
                ranked={model.ranked}
                swept={model.swept}
                mode={model.mode}
                ctx={model.ctx}
                selected={selected}
                pinned={selection.pinned}
                projectIds={projectPicks.map((pick) => pick.id)}
                onBattery={chooseBattery}
                onQuantity={chooseQuantity}
                onReset={() => setOverride(null)}
              />
              <SelectionCard
                selected={selected}
                best={selection.top}
                modeLabel={model.mode.label}
                miss={constraintMissLabel(selected, model.mode, model.ctx)}
              />
              <BackupResult
                estimate={selected.backup_estimate ?? null}
                backupMode={backupMode}
                backupShape={backupShape}
                backupPercent={backupPercent}
                criticalKw={criticalKw}
                outageSoc={outageSoc}
                outageSolar={outageSolar}
              />
              {detail ? <MonthlyBills simulation={detail} /> : null}
              {detail?.hourly ? (
                <DispatchDay
                  load={model.sim.load_kwh}
                  solar={model.sim.solar_kwh}
                  discharge={detail.hourly.discharge_ac_kwh}
                  gridImport={detail.hourly.grid_import_kwh}
                />
              ) : null}
              <SavingsChart series={chartSeries} />
              <div className="table-wrap">
                <table data-testid="comparison-table" className="pick-table">
                  <caption>
                    Comparison
                    {modeId === BACKUP_DURATION.id
                      ? ". Backup hours are the typical outage duration, the same figure as the detail view."
                      : ""}
                  </caption>
                  <thead>
                    <tr>
                      <th>Battery</th>
                      <th>Qty</th>
                      <th>Savings</th>
                      <th>Payback</th>
                      <th>NPV</th>
                      <th>Peak cut</th>
                      <th>Self-use</th>
                      <th>Cycles</th>
                      <th data-testid="backup-column">Backup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.ranked.map((row) => {
                      const picked = row.battery.id === selected.battery.id && row.quantity === selected.quantity;
                      return (
                        <tr
                          key={`${row.battery.id}-${row.quantity}`}
                          className={picked ? "is-selected" : undefined}
                          aria-selected={picked}
                          onClick={() => setOverride({ batteryId: row.battery.id, quantity: row.quantity })}
                        >
                          <td>{row.battery.name}</td>
                          <td>{row.quantity}</td>
                          <td>{money(row.annual_savings_usd)}</td>
                          <td>{years(row.simple_payback_years)}</td>
                          <td>{money(row.npv_usd)}</td>
                          <td>{row.peak_reduction_kw.toFixed(1)} kW</td>
                          <td>{row.self_consumption_pct == null ? "—" : `${Math.round(row.self_consumption_pct * 100)}%`}</td>
                          <td>{row.equivalent_cycles.toFixed(0)}</td>
                          <td>{row.backup_hours == null ? "—" : `${row.backup_hours.toFixed(1)} h`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hint" data-testid="sizer-caveat">
                {(selected.warnings.length > 0 ? selected.warnings : ["Demand uses the hourly peak unless billed peaks are set."])
                  .slice(0, 2)
                  .join(" ")}{" "}
                {studyWarnings.join(" ")} NPV is pre-tax and ignores incentives. Degradation is {degradation}% per year,
                applied to the cash flows, not by re-simulating a worn battery.
              </div>
            </>
          ) : (
            <p className="warn-line" role="alert">
              {model.ok ? "Add a battery to rank." : model.error}
            </p>
          )}
          <details className="assumptions">
            <summary>Model assumptions</summary>
            <ul>
              {MODEL_ASSUMPTIONS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </section>
      </div>

      <InterconnectPanel
        usableKwh={selected ? selected.battery.usable_capacity_kwh * selected.quantity : null}
        dischargeKw={selected ? selected.battery.max_discharge_rate_kw * selected.quantity : null}
        aggregateKw={selected ? selected.battery.max_discharge_rate_kw * selected.quantity : null}
        unitKwh={selected ? selected.battery.usable_capacity_kwh : null}
        unitCount={selected ? selected.quantity : null}
        customerPeakKw={buildingPeak > 0 ? buildingPeak : null}
      />

      <footer className="footer">
        <p>Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.</p>
      </footer>
    </div>
  );
}

function BatteryOverride({
  ranked,
  swept,
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
        <button type="button" className="text-button" onClick={onReset}>
          Reset to best
        </button>
      ) : (
        <p className="meta">Showing the best for this mode.</p>
      )}
    </div>
  );
}

function SelectionCard({
  selected,
  best,
  modeLabel,
  miss,
}: {
  selected: CandidateMetrics;
  best: CandidateMetrics;
  modeLabel: string;
  miss: string | null;
}) {
  const isBest = selected.battery.id === best.battery.id && selected.quantity === best.quantity;
  const self =
    selected.self_consumption_pct == null ? "—" : `${Math.round(selected.self_consumption_pct * 100)}%`;
  return (
    <div className="money" data-testid="top-pick">
      <p className="money-kicker" data-testid="selection-badge">
        {isBest ? `Best for ${modeLabel}` : "Selected battery"}
      </p>
      <p className="dollars" data-testid="selection-title">
        {selected.quantity} × {selected.battery.name}
      </p>
      <p className="rate-line">
        {money(selected.annual_savings_usd)} / yr · payback {years(selected.simple_payback_years)} · NPV{" "}
        {money(selected.npv_usd)} · peak cut {selected.peak_reduction_kw.toFixed(1)} kW · solar self-consumption {self} ·{" "}
        {money(selected.installed_cost_usd)} installed
      </p>
      {isBest ? null : (
        <p className="rate-line" data-testid="selection-compare">
          {compareWithBest(selected, best, modeLabel)}
        </p>
      )}
      {miss ? (
        <p className="disclaimer" data-testid="constraint-note">
          {miss}
        </p>
      ) : null}
    </div>
  );
}

function BackupResult({
  estimate,
  backupMode,
  backupShape,
  backupPercent,
  criticalKw,
  outageSoc,
  outageSolar,
}: {
  estimate: BackupEstimate | null;
  backupMode: BackupLoadMode;
  backupShape: BackupLoadShape;
  backupPercent: string;
  criticalKw: string;
  outageSoc: string;
  outageSolar: boolean;
}) {
  if (!estimate) return null;
  const requested = Number(outageSoc) / 100;
  const clamped = Number.isFinite(requested) && Math.abs(requested - estimate.start_soc) > 0.001;
  const power = formatBackupPowerLimit(estimate);
  return (
    <div className="backup-result" data-testid="backup-result">
      <p className="kicker">Backup duration</p>
      <p className="backup-headline" data-testid="backup-headline">
        {formatBackupHeadline(estimate)}
      </p>
      <p className="meta">{backupScenarioText(backupMode, backupShape, backupPercent, criticalKw, estimate, outageSolar)}</p>
      {clamped ? (
        <p className="note">Starting charge is clamped to {Math.round(estimate.start_soc * 100)}% by the SOC window.</p>
      ) : null}
      {estimate.horizon_reached ? (
        <p className="note">At least one start hour is still going at the {estimate.horizon_hours}-hour cap.</p>
      ) : null}
      {power ? <p className="warn-line">{power}</p> : null}
      <ul className="point-list">
        <li>
          <span>Average load</span>
          <span>{hoursOrEmpty(estimate.hours_at_average_load)}</span>
        </li>
        <li>
          <span>Peak-load hour</span>
          <span>{hoursOrEmpty(estimate.hours_at_peak_load)}</span>
        </li>
        <li>
          <span>Worst start</span>
          <span>{estimate.hours_min.toFixed(1)} h</span>
        </li>
        <li>
          <span>Typical start</span>
          <span>{estimate.hours_typical.toFixed(1)} h</span>
        </li>
        <li>
          <span>Conservative</span>
          <span>{estimate.hours_conservative.toFixed(1)} h</span>
        </li>
        <li>
          <span>Best start</span>
          <span>{estimate.hours_max.toFixed(1)} h</span>
        </li>
      </ul>
      <ul className="backup-limits">
        {BACKUP_ASSUMPTIONS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function MonthlyBills({ simulation }: { simulation: SimulationResult }) {
  return (
    <div className="table-wrap">
      <table data-testid="monthly-bills">
        <caption>Monthly bills</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Baseline</th>
            <th>With battery</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody>
          {simulation.baseline.months.map((month, index) => {
            const withBattery = simulation.with_battery.months[index];
            return (
              <tr key={month.month}>
                <td>{MONTH_SHORT[index]}</td>
                <td>{money(month.total_usd)}</td>
                <td>{money(withBattery?.total_usd ?? 0)}</td>
                <td>{money(month.total_usd - (withBattery?.total_usd ?? 0))}</td>
              </tr>
            );
          })}
          <tr>
            <td>Year</td>
            <td>{money(simulation.baseline.total_usd)}</td>
            <td>{money(simulation.with_battery.total_usd)}</td>
            <td>{money(simulation.annual_savings_usd)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DispatchDay({
  load,
  solar,
  discharge,
  gridImport,
}: {
  load: readonly number[];
  solar: readonly number[];
  discharge: readonly number[];
  gridImport: readonly number[];
}) {
  let peakHour = 0;
  let peak = -Infinity;
  for (let hour = 0; hour < load.length; hour += 1) {
    if (load[hour] > peak) {
      peak = load[hour];
      peakHour = hour;
    }
  }
  const dayStart = peakHour - (peakHour % 24);
  const stamp = monthStamp(dayStart);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const slice = (series: readonly number[]) => hours.map((hour) => series[dayStart + hour] ?? 0);
  return (
    <div data-testid="dispatch-view">
      <DispatchChart
        label={`Dispatch on the peak-load day, ${stamp.month} ${stamp.day}`}
        series={[
          { name: "Load", color: "#1c1712", values: slice(load) },
          { name: "Solar", color: "#8a5710", values: slice(solar) },
          { name: "Discharge", color: "#1d4a38", values: slice(discharge) },
          { name: "Grid import", color: "#8d3414", values: slice(gridImport) },
        ]}
      />
      <p className="meta">Hourly dispatch for the day that contains the highest building load. Grid import is after the battery.</p>
    </div>
  );
}

function backupScenarioFromInputs(input: {
  backupMode: BackupLoadMode;
  backupShape: BackupLoadShape;
  backupPercent: string;
  criticalKw: string;
  outageSoc: string;
  outageSolar: boolean;
}): BackupScenario {
  const start = Number(input.outageSoc) / 100;
  if (!Number.isFinite(start) || start < 0 || start > 1) {
    throw new Error("Outage starting charge must be from 0% to 100%.");
  }
  return {
    load_mode: input.backupMode,
    shape: input.backupMode === "backup_loads" ? input.backupShape : undefined,
    critical_load_kw:
      input.backupMode === "backup_loads" && input.backupShape === "fixed_kw" ? Number(input.criticalKw) : undefined,
    critical_load_fraction:
      input.backupMode === "backup_loads" && input.backupShape === "percent_of_load"
        ? Number(input.backupPercent) / 100
        : undefined,
    start_soc: start,
    include_solar: input.outageSolar,
  };
}

function resolveSelection(
  ranked: readonly CandidateMetrics[],
  override: { batteryId: string; quantity: number } | null,
): { top: CandidateMetrics; selected: CandidateMetrics; pinned: boolean } | null {
  const top = ranked[0];
  if (!top) return null;
  const match = override
    ? ranked.find((row) => row.battery.id === override.batteryId && row.quantity === override.quantity)
    : undefined;
  return { top, selected: match ?? top, pinned: match != null };
}

function uniqueBatteries(rows: readonly CandidateMetrics[]): Battery[] {
  const seen = new Map<string, Battery>();
  for (const row of rows) {
    if (!seen.has(row.battery.id)) seen.set(row.battery.id, row.battery);
  }
  return [...seen.values()];
}

function compareWithBest(selected: CandidateMetrics, best: CandidateMetrics, modeLabel: string): string {
  const savings = signedMoney(selected.annual_savings_usd - best.annual_savings_usd);
  let payback = "payback unavailable";
  if (selected.simple_payback_years != null && best.simple_payback_years != null) {
    payback = `${signedYears(selected.simple_payback_years - best.simple_payback_years)} payback`;
  }
  return `Compared with the best for ${modeLabel}: ${savings} / yr savings, ${payback}.`;
}

function signedMoney(value: number): string {
  const formatted = formatUsd(value);
  if (value > 0.004 && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

function signedYears(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} yr`;
}

function backupScenarioText(
  backupMode: BackupLoadMode,
  backupShape: BackupLoadShape,
  backupPercent: string,
  criticalKw: string,
  estimate: BackupEstimate,
  outageSolar: boolean,
): string {
  const charge = `${Math.round(estimate.start_soc * 100)}% charge`;
  const solar = outageSolar ? "Solar is credited (optimistic)." : "Solar is not credited.";
  if (backupMode === "whole_building") return `Whole building load, starting at ${charge}. ${solar}`;
  if (backupShape === "percent_of_load") {
    return `Backup loads at ${backupPercent}% of each hour, starting at ${charge}. ${solar}`;
  }
  return `Backup loads at ${criticalKw} kW, starting at ${charge}. ${solar}`;
}

function hoursOrEmpty(hours: number | null): string {
  if (hours == null) return "No load";
  return `${hours.toFixed(1)} h`;
}

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function monthStamp(hour: number): { month: string; day: number } {
  let cursor = 0;
  for (let month = 0; month < 12; month += 1) {
    const hours = DAYS_IN_MONTH[month] * 24;
    if (hour < cursor + hours) return { month: MONTH_LONG[month], day: Math.floor((hour - cursor) / 24) + 1 };
    cursor += hours;
  }
  return { month: "December", day: 31 };
}

function buildSimpleRate(input: {
  flatEnergy: string;
  peakEnergy: string;
  peakStart: string;
  peakEnd: string;
  facilities: string;
  peakDemand: string;
  fixedCharge: string;
  exportCredit: string;
}): RateModel {
  const start = Number(input.peakStart);
  const end = Number(input.peakEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start) {
    throw new Error("Peak hours must be whole hours, with the end after the start.");
  }
  const offPeak = hoursBetween(0, 24).map((_, hour) => hour < start || hour >= end);
  return {
    id: "simple",
    name: "Simple rate (not a utility tariff)",
    seasons: [],
    energy_periods: [
      {
        name: "Off-peak",
        weekday_hours: offPeak,
        weekend_hours: hoursBetween(0, 24),
        energy_rate_kwh: requiredNumber(input.flatEnergy, "Off-peak energy"),
      },
      {
        name: "On-peak",
        weekday_hours: hoursBetween(start, end),
        weekend_hours: NO_HOURS,
        energy_rate_kwh: requiredNumber(input.peakEnergy, "On-peak energy"),
      },
    ],
    demand_components: [
      {
        name: "Facilities",
        is_facilities: true,
        weekday_hours: hoursBetween(0, 24),
        weekend_hours: hoursBetween(0, 24),
        demand_rate_kw: requiredNumber(input.facilities, "Facilities demand"),
      },
      {
        name: "On-peak demand",
        is_facilities: false,
        weekday_hours: hoursBetween(start, end),
        weekend_hours: NO_HOURS,
        demand_rate_kw: requiredNumber(input.peakDemand, "On-peak demand"),
      },
    ],
    fixed_monthly_charge: requiredNumber(input.fixedCharge, "Fixed charge"),
    export_credit_kwh: requiredNumber(input.exportCredit, "Export credit"),
  };
}

function requiredNumber(text: string, label: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or positive.`);
  return value;
}

function batteriesToCatalog(rows: BatteryRow[], roundTrip: number, degradation: number): Battery[] {
  if (rows.length === 0) throw new Error("Add at least one battery.");
  if (!(roundTrip > 0) || roundTrip > 1) throw new Error("Round-trip efficiency must be between 0% and 100%.");
  if (!(degradation >= 0) || degradation >= 1) throw new Error("Degradation must be from 0% up to, but not including, 100%.");
  return rows.map((row) => ({
    id: row.key,
    name: row.name.trim() || "Battery",
    usable_capacity_kwh: requiredPositive(row.usable, `${row.name} usable kWh`),
    max_charge_rate_kw: requiredNumber(row.charge, `${row.name} charge kW`),
    max_discharge_rate_kw: requiredNumber(row.discharge, `${row.name} discharge kW`),
    cost_per_unit: requiredNumber(row.cost, `${row.name} first cost`),
    cost_per_additional_unit: requiredNumber(row.extra, `${row.name} additional cost`),
    round_trip_efficiency: roundTrip,
    degradation_per_year: degradation,
  }));
}

function requiredPositive(text: string, label: string): number {
  const value = requiredNumber(text, label);
  if (!(value > 0)) throw new Error(`${label} must be greater than zero.`);
  return value;
}

function seriesByBattery(rows: CandidateMetrics[]): { name: string; points: { kwh: number; savings: number }[] }[] {
  const groups = new Map<string, { name: string; points: { kwh: number; savings: number }[] }>();
  for (const row of rows) {
    const group = groups.get(row.battery.id) ?? { name: row.battery.name, points: [] };
    group.points.push({
      kwh: row.battery.usable_capacity_kwh * row.quantity,
      savings: row.annual_savings_usd,
    });
    groups.set(row.battery.id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    points: group.points.sort((a, b) => a.kwh - b.kwh),
  }));
}

function DispatchChart({
  label,
  series,
}: {
  label: string;
  series: { name: string; color: string; values: number[] }[];
}) {
  const width = 640;
  const height = 220;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const flat = series.flatMap((entry) => entry.values);
  const maxKw = Math.max(1, ...flat);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (hour: number) => padL + (hour / 23) * plotW;
  const yAt = (kw: number) => padT + (1 - Math.max(0, kw) / maxKw) * plotH;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <title>{label}</title>
        <line className="chart-axis" x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} />
        <line className="chart-axis" x1={padL} y1={padT} x2={padL} y2={padT + plotH} />
        {series.map((entry) => (
          <polyline
            key={entry.name}
            fill="none"
            stroke={entry.color}
            strokeWidth="2.2"
            points={entry.values.map((value, hour) => `${xAt(hour).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ")}
          />
        ))}
        <text className="chart-label" x={padL} y={height - 8}>
          0:00
        </text>
        <text className="chart-label" x={width - padR - 36} y={height - 8}>
          23:00
        </text>
        <text className="chart-label" x={4} y={padT + 8}>
          {Math.round(maxKw)} kW
        </text>
      </svg>
      <ul className="legend">
        {series.map((entry) => (
          <li key={entry.name}>
            <i style={{ background: entry.color }} />
            {entry.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SavingsChart({ series }: { series: { name: string; points: { kwh: number; savings: number }[] }[] }) {
  const width = 640;
  const height = 220;
  const padL = 56;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const points = series.flatMap((entry) => entry.points);
  if (points.length === 0) return null;
  const maxKwh = Math.max(...points.map((point) => point.kwh), 1);
  const maxSavings = Math.max(1, ...points.map((point) => point.savings));
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (kwh: number) => padL + (kwh / maxKwh) * plotW;
  const yAt = (savings: number) => padT + (1 - Math.max(0, savings) / maxSavings) * plotH;
  const colors = ["#8d3414", "#1d4a38", "#1c1712", "#8a5710"];
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Annual savings versus battery size"
      data-testid="savings-chart"
    >
      <title>Annual savings versus usable kWh. A flattening line is diminishing returns.</title>
      <line className="chart-axis" x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} />
      <line className="chart-axis" x1={padL} y1={padT} x2={padL} y2={padT + plotH} />
      {series.map((entry, index) => (
        <polyline
          key={entry.name}
          fill="none"
          stroke={colors[index % colors.length]}
          strokeWidth="2.4"
          points={entry.points.map((point) => `${xAt(point.kwh).toFixed(1)},${yAt(point.savings).toFixed(1)}`).join(" ")}
        />
      ))}
      <text className="chart-label" x={padL} y={height - 8}>
        0
      </text>
      <text className="chart-label" x={width - padR - 48} y={height - 8}>
        {Math.round(maxKwh)} kWh
      </text>
      <text className="chart-label" x={4} y={padT + 8}>
        {formatUsd(maxSavings)}
      </text>
    </svg>
  );
}
