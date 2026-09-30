import { useEffect, useMemo, useState } from "react";
import { HOURS_PER_YEAR } from "../dispatch/calendar";
import { BACKUP_DURATION, CHEAPEST_PEAK_TARGET, RANKING_MODES } from "../dispatch/rank";
import { simulateDispatch } from "../dispatch/simulate";
import { syntheticExample } from "../dispatch/synthetic-example";
import type { Battery, DispatchStrategy, RateModel } from "../dispatch/types";
import type { BackupLoadMode, BackupLoadShape } from "../dispatch/backup";
import { parseHourlyNumbers } from "../dispatch/series-input";
import { groupProjectsByCustomer } from "../sun-daddy/customers";
import { normalizeBatteryCatalog, normalizeProjectList } from "../sun-daddy/normalize";
import type { NormalizedStudy, ProjectListItem } from "../sun-daddy/types";
import { InterconnectPanel } from "./InterconnectPanel";
import { SizerProvider, type StudyMeta, type SizerContextValue } from "./sizer/context";
import { WizardChrome } from "./sizer/WizardChrome";
import {
  chooseQuantityForBattery,
  rankSweep,
  resolveSelection,
  rowsFromBatteries,
  runSweep,
  seriesByBattery,
  type BatteryRow,
} from "./sizer/model";
import { peakOf, sum } from "./sizer/format";
import { canAdvanceWizard, isWizardStep, type WizardStepId } from "./sizer/wizard";

const example = syntheticExample();

export default function CatalogSizer({ surface }: { surface: "wizard" | "interconnect" }) {
  const [step, setStep] = useState<WizardStepId>(1);
  const [maxReached, setMaxReached] = useState<WizardStepId>(1);
  const [source, setSource] = useState<"none" | "example" | "manual" | "sun">("none");
  const [loadKwh, setLoadKwh] = useState<number[]>([]);
  const [solarKwh, setSolarKwh] = useState<number[]>([]);
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
  const [batteryOrigin, setBatteryOrigin] = useState<"example" | "sun" | "project">("example");
  const [sunCatalog, setSunCatalog] = useState<Battery[] | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "sun" | "example">("loading");
  const [strategy, setStrategy] = useState<DispatchStrategy>("combined");
  const [modeId, setModeId] = useState(RANKING_MODES[0].id);
  const [rte, setRte] = useState("90");
  const [degradation, setDegradation] = useState("2");
  const [socMin, setSocMin] = useState("0");
  const [socMax, setSocMax] = useState("100");
  const [discount, setDiscount] = useState("6");
  const [escalator, setEscalator] = useState("2");
  const [analysisYears, setAnalysisYears] = useState("25");
  const [maxQuantity, setMaxQuantity] = useState("3");
  const [criticalKw, setCriticalKw] = useState("25");
  const [backupHours, setBackupHours] = useState("4");
  const [backupMode, setBackupMode] = useState<BackupLoadMode>("backup_loads");
  const [backupShape, setBackupShape] = useState<BackupLoadShape>("percent_of_load");
  const [backupPercent, setBackupPercent] = useState("30");
  const [outageSoc, setOutageSoc] = useState("100");
  const [outageSolar, setOutageSolar] = useState(false);
  const [override, setOverride] = useState<{ batteryId: string; quantity: number } | null>(null);
  const [peakTarget, setPeakTarget] = useState("20");
  const [billedText, setBilledText] = useState("");
  const [loadText, setLoadText] = useState("");
  const [solarText, setSolarText] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [openCustomerKey, setOpenCustomerKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sunMessage, setSunMessage] = useState<string | null>(null);
  const [sunError, setSunError] = useState(false);
  const [loadedNote, setLoadedNote] = useState<string | null>(null);
  const [studyWarnings, setStudyWarnings] = useState<string[]>([]);
  const [inputWarnings, setInputWarnings] = useState<string[]>([]);
  const [tariffWarnings, setTariffWarnings] = useState<string[]>([]);
  const [meta, setMeta] = useState<StudyMeta>({ customerName: "—", projectName: "—", utility: null });
  const [busy, setBusy] = useState(false);

  const needsRank = step >= 3 && loadKwh.length === HOURS_PER_YEAR;
  const sweep = useMemo(
    () => {
      if (!needsRank) return { ok: false as const, error: "Load an 8,760-hour profile to rank batteries." };
      return runSweep({
        loadKwh,
        solarKwh,
        rate,
        simpleRate,
        simple: { flatEnergy, peakEnergy, peakStart, peakEnd, facilities, peakDemand, fixedCharge, exportCredit },
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
      });
    },
    [
      needsRank,
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
    ],
  );

  const model = useMemo(() => {
    if (!sweep.ok) return sweep;
    return rankSweep(sweep, modeId, peakTarget, backupHours);
  }, [sweep, modeId, peakTarget, backupHours]);

  const selection = model.ok ? resolveSelection(model.ranked, override) : null;
  const chartSeries = model.ok ? seriesByBattery(model.swept) : [];
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
    if (!override || !model.ok) return;
    const alive = model.ranked.some((row) => row.battery.id === override.batteryId && row.quantity === override.quantity);
    if (!alive) setOverride(null);
  }, [model, override]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const response = await fetch("/api/sun-daddy/batteries");
        const body: unknown = await response.json();
        if (cancel) return;
        if (!response.ok) {
          setCatalogStatus("example");
          return;
        }
        const parsed = normalizeBatteryCatalog(body);
        if (parsed.batteries.length === 0) {
          setCatalogStatus("example");
          return;
        }
        setSunCatalog(parsed.batteries);
        setCatalogStatus("sun");
      } catch {
        if (!cancel) setCatalogStatus("example");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!sunCatalog || source !== "none") return;
    setBatteries(rowsFromBatteries(sunCatalog));
    setBatteryOrigin("sun");
  }, [sunCatalog, source]);

  const hasData = loadKwh.length === HOURS_PER_YEAR;
  const canNext = canAdvanceWizard(step, { hasData, modelOk: model.ok });
  const groups = useMemo(() => groupProjectsByCustomer(projects), [projects]);
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

  function goNext() {
    if (!canAdvanceWizard(step, { hasData, modelOk: model.ok })) return;
    const next = step + 1;
    if (!isWizardStep(next)) return;
    setStep(next);
    setMaxReached((current) => (next > current ? next : current));
  }

  function goBack() {
    if (step === 1) return;
    const previous = step - 1;
    if (!isWizardStep(previous)) return;
    setStep(previous);
  }

  function goTo(target: WizardStepId) {
    if (target > maxReached) return;
    setStep(target);
  }

  async function searchProjects() {
    setBusy(true);
    setSunError(false);
    setSunMessage(null);
    setOpenCustomerKey(null);
    try {
      const response = await fetch(`/api/sun-daddy/projects?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as { error?: string; projects?: unknown; warnings?: string[] };
      if (!response.ok) {
        setProjects([]);
        setSunError(true);
        setSunMessage(body.error ?? "Sun Daddy isn't available. The synthetic example still runs on this screen.");
        return;
      }
      const listed = normalizeProjectList(Array.isArray(body.projects) ? body.projects : []);
      setProjects(listed.projects);
      const serverWarnings = Array.isArray(body.warnings) ? body.warnings : [];
      const warning =
        serverWarnings.find((entry) => typeof entry === "string" && entry.trim().length > 0) ?? listed.warnings[0];
      setSunError(false);
      setSunMessage(warning ?? (listed.projects.length === 0 ? "No matching projects." : null));
    } catch {
      setProjects([]);
      setSunError(true);
      setSunMessage("Sun Daddy isn't available from this session. Paste hourly CSVs or keep the synthetic example.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(project: ProjectListItem) {
    setBusy(true);
    setSunError(false);
    setSunMessage(null);
    try {
      const response = await fetch(`/api/sun-daddy/project/${encodeURIComponent(project.id)}`);
      const body = (await response.json()) as { error?: string; normalized?: NormalizedStudy };
      if (!response.ok || !body.normalized) {
        setSunError(true);
        setSunMessage(body.error ?? "That project could not be loaded.");
        return;
      }
      applyStudy(body.normalized, project);
    } catch {
      setSunError(true);
      setSunMessage("Sun Daddy isn't available from this session.");
    } finally {
      setBusy(false);
    }
  }

  function applyStudy(study: NormalizedStudy, project: ProjectListItem) {
    const tariff = study.pre_rate.warnings;
    const notes = study.warnings.filter((warning) => !tariff.includes(warning));
    if (study.load_kwh) setLoadKwh(study.load_kwh);
    else notes.push("This project has no complete 8,760-hour load, so the previous load was kept.");
    if (study.solar_kwh) setSolarKwh(study.solar_kwh);
    if (study.pre_rate.rate) {
      setRate(study.pre_rate.rate);
      setSimpleRate(false);
    }
    if (study.batteries.length > 0) {
      setBatteries(rowsFromBatteries(study.batteries));
      setBatteryOrigin("project");
    } else if (sunCatalog && sunCatalog.length > 0) {
      setBatteries(rowsFromBatteries(sunCatalog));
      setBatteryOrigin("sun");
    } else {
      setBatteries(rowsFromBatteries(syntheticExample().batteries));
      setBatteryOrigin("example");
    }
    if (study.economics.discount_rate != null) setDiscount(String(study.economics.discount_rate * 100));
    if (study.economics.rate_escalator != null) setEscalator(String(study.economics.rate_escalator * 100));
    if (study.economics.analysis_period != null) setAnalysisYears(String(study.economics.analysis_period));
    const peaks = study.billed_peak_kw.filter((peak) => peak != null);
    if (peaks.length === 12) setBilledText(study.billed_peak_kw.join(", "));
    setSource("sun");
    setMeta({
      customerName: project.customer_name?.trim() || "No customer",
      projectName: study.project_name ?? project.name,
      utility: project.utility ?? null,
    });
    setTariffWarnings(tariff);
    setStudyWarnings(notes);
    setInputWarnings([]);
    setLoadedNote(study.project_name ? `Loaded ${study.project_name}.` : "Project loaded.");
    setOverride(null);
  }

  function loadExample() {
    const fresh = syntheticExample();
    setLoadKwh(fresh.load_kwh);
    setSolarKwh(fresh.solar_kwh);
    setRate(fresh.rate);
    setBatteries(rowsFromBatteries(fresh.batteries));
    setBatteryOrigin("example");
    setSimpleRate(false);
    setBilledText("140");
    setSource("example");
    setStudyWarnings([]);
    setTariffWarnings([]);
    setInputWarnings([]);
    setSunMessage(null);
    setSunError(false);
    setMeta({ customerName: "Example customer", projectName: "Synthetic building", utility: null });
    setLoadedNote("Example data is ready.");
    setOverride(null);
    setDiscount("6");
    setEscalator("2");
    setAnalysisYears("25");
  }

  function readLoadFile(text: string) {
    try {
      setLoadKwh(parseHourlyNumbers(text));
      setSource("manual");
      setInputWarnings([]);
      setLoadedNote("Hourly load is ready.");
      setMeta((current) =>
        current.projectName === "—" ? { customerName: "Manual entry", projectName: "Uploaded load", utility: null } : current,
      );
    } catch (error) {
      setInputWarnings([error instanceof Error ? error.message : "Could not read the load file."]);
    }
  }

  function readSolarFile(text: string) {
    try {
      setSolarKwh(parseHourlyNumbers(text));
      setInputWarnings([]);
      if (source === "none") setSource("manual");
    } catch (error) {
      setInputWarnings([error instanceof Error ? error.message : "Could not read the solar file."]);
    }
  }

  function chooseBattery(batteryId: string) {
    if (!model.ok) return;
    setOverride({
      batteryId,
      quantity: chooseQuantityForBattery(model.ranked, batteryId, model.mode, model.ctx),
    });
  }

  function chooseQuantity(quantity: number) {
    if (!selected) return;
    setOverride({ batteryId: selected.battery.id, quantity });
  }

  const catalogNotice = catalogNoticeText(catalogStatus, batteryOrigin);
  const activeRateName = simpleRate ? "Simple rate (not a utility tariff)" : (rate.name ?? "Rate");
  const value: SizerContextValue = {
    surface,
    step,
    maxReached,
    canNext,
    hasData,
    goNext,
    goBack,
    goTo,
    query,
    setQuery,
    busy,
    sunMessage,
    sunError,
    loadedNote,
    groups,
    openCustomerKey,
    setOpenCustomerKey,
    searchProjects: () => void searchProjects(),
    openProject: (project) => void openProject(project),
    loadExample,
    source,
    manualOpen,
    setManualOpen,
    loadText,
    setLoadText,
    solarText,
    setSolarText,
    readLoadText: () => readLoadFile(loadText),
    readSolarText: () => readSolarFile(solarText),
    readLoadFile,
    readSolarFile,
    inputWarnings,
    meta,
    rateName: activeRateName,
    annualLoadKwh: sum(loadKwh),
    peakKw: peakOf(loadKwh),
    annualSolarKwh: sum(solarKwh),
    tariffWarnings,
    checkWarnings: studyWarnings,
    billedText,
    setBilledText,
    simpleRate,
    setSimpleRate,
    flatEnergy,
    setFlatEnergy,
    peakEnergy,
    setPeakEnergy,
    peakStart,
    setPeakStart,
    peakEnd,
    setPeakEnd,
    facilities,
    setFacilities,
    peakDemand,
    setPeakDemand,
    fixedCharge,
    setFixedCharge,
    exportCredit,
    setExportCredit,
    modeId,
    setModeId,
    peakTarget,
    setPeakTarget,
    backupHours,
    setBackupHours,
    catalogNotice,
    strategy,
    setStrategy,
    rte,
    setRte,
    degradation,
    setDegradation,
    socMin,
    setSocMin,
    socMax,
    setSocMax,
    discount,
    setDiscount,
    escalator,
    setEscalator,
    analysisYears,
    setAnalysisYears,
    maxQuantity,
    setMaxQuantity,
    backupMode,
    setBackupMode,
    backupShape,
    setBackupShape,
    backupPercent,
    setBackupPercent,
    criticalKw,
    setCriticalKw,
    outageSoc,
    setOutageSoc,
    outageSolar,
    setOutageSolar,
    model,
    selection,
    detail,
    chartSeries,
    unmetPeak,
    unmetBackup,
    chooseBattery,
    chooseQuantity,
    selectStack: (batteryId, quantity) => setOverride({ batteryId, quantity }),
    resetOverride: () => setOverride(null),
    buildingPeakKw: peakOf(loadKwh),
    rankContext: model.ok ? model.ctx : {},
    rankMode: model.ok ? model.mode : null,
  };

  return (
    <SizerProvider value={value}>
      {surface === "interconnect" ? (
        <div className="wrap">
          <InterconnectPanel
            usableKwh={selected ? selected.battery.usable_capacity_kwh * selected.quantity : null}
            dischargeKw={selected ? selected.battery.max_discharge_rate_kw * selected.quantity : null}
            aggregateKw={selected ? selected.battery.max_discharge_rate_kw * selected.quantity : null}
            unitKwh={selected ? selected.battery.usable_capacity_kwh : null}
            unitCount={selected ? selected.quantity : null}
            customerPeakKw={hasData && peakOf(loadKwh) > 0 ? peakOf(loadKwh) : null}
          />
        </div>
      ) : (
        <WizardChrome />
      )}
    </SizerProvider>
  );
}

function catalogNoticeText(
  catalogStatus: "loading" | "sun" | "example",
  batteryOrigin: "example" | "sun" | "project",
): string {
  if (catalogStatus === "loading") return "Checking Sun Daddy for a battery catalog.";
  if (batteryOrigin === "project") return "These batteries came with the project.";
  if (batteryOrigin === "sun") return "Battery catalog loaded from Sun Daddy.";
  if (catalogStatus === "example") {
    return "Example battery catalog. Sun Daddy's catalog wasn't available, so the built-in list is the fallback.";
  }
  return "Example batteries are in use for this synthetic building. Sun Daddy's catalog is available when a project does not include its own.";
}
