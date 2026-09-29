import { useMemo, useState } from "react";
import { MODEL_ASSUMPTIONS } from "../dispatch/assumptions";
import { HOURS_PER_YEAR, NO_HOURS, hoursBetween } from "../dispatch/calendar";
import {
  BACKUP_DURATION,
  CHEAPEST_PEAK_TARGET,
  RANKING_MODES,
  rankCandidates,
  rankingMode,
  sweepBatteries,
  type CandidateMetrics,
} from "../dispatch/rank";
import { parseBilledPeaks, parseHourlyNumbers } from "../dispatch/series-input";
import { syntheticExample } from "../dispatch/synthetic-example";
import type { Battery, DispatchStrategy, RateModel } from "../dispatch/types";
import { normalizeProjectList } from "../sun-daddy/normalize";
import type { NormalizedStudy, ProjectListItem } from "../sun-daddy/types";
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
};

const STRATEGIES: { id: DispatchStrategy; label: string }[] = [
  { id: "combined", label: "Combined" },
  { id: "demand_peak_shave", label: "Demand peak shaving" },
  { id: "tou_arbitrage", label: "TOU arbitrage" },
  { id: "solar_self_consumption", label: "Solar self-consumption" },
];

const ROW_FIELDS = ["name", "usable", "charge", "discharge", "cost", "extra"] as const;

const example = syntheticExample();

function rowsFromBatteries(batteries: Battery[]): BatteryRow[] {
  return batteries.map((battery) => ({
    key: battery.id,
    name: battery.name,
    usable: String(battery.usable_capacity_kwh),
    charge: String(battery.max_charge_rate_kw),
    discharge: String(battery.max_discharge_rate_kw),
    cost: String(battery.cost_per_unit),
    extra: String(battery.cost_per_additional_unit ?? battery.cost_per_unit),
  }));
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
  const [peakTarget, setPeakTarget] = useState("20");
  const [billedText, setBilledText] = useState("140");
  const [loadText, setLoadText] = useState("");
  const [solarText, setSolarText] = useState("");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [query, setQuery] = useState("");
  const [sunMessage, setSunMessage] = useState<string | null>(null);
  const [studyWarnings, setStudyWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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
      const critical = Number(criticalKw);
      const billed = parseBilledPeaks(billedText);
      if (!(quantity >= 1) || !Number.isInteger(quantity) || quantity > 12) {
        return { ok: false as const, error: "Max units must be a whole number from 1 to 12." };
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
        critical_load_kw: critical,
      });
      return { ok: true as const, swept };
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
  ]);

  const model = useMemo(() => {
    if (!sweep.ok) return sweep;
    try {
      const mode = rankingMode(modeId);
      const ranked = rankCandidates(sweep.swept, mode, {
        target_peak_reduction_kw: Number(peakTarget),
        backup_target_hours: Number(backupHours),
      });
      return { ok: true as const, ranked, swept: sweep.swept, mode };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not rank these batteries." };
    }
  }, [sweep, modeId, peakTarget, backupHours]);

  const top = model.ok ? model.ranked[0] : null;
  const chartSeries = model.ok ? seriesByBattery(model.swept) : [];
  const buildingPeak = loadKwh.reduce((max, value) => Math.max(max, value), 0);

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
    if (study.batteries.length > 0) setBatteries(rowsFromBatteries(study.batteries));
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
    setBatteries(rowsFromBatteries(fresh.batteries));
    setSimpleRate(false);
    setBilledText("140");
    setSource("example");
    setStudyWarnings([]);
    setSunMessage(null);
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

  const unmetPeak =
    model.ok && modeId === CHEAPEST_PEAK_TARGET.id && top != null && top.peak_reduction_kw + 1e-6 < Number(peakTarget);
  const unmetBackup =
    model.ok && modeId === BACKUP_DURATION.id && top != null && (top.backup_hours ?? 0) + 1e-9 < Number(backupHours);

  return (
    <div className="wrap">
      <header className="mast">
        <div>
          <p className="kicker">Hourly dispatch · Utah, California, Nevada, Idaho</p>
          <h1>Battery Bench</h1>
          <p className="lede">
            Pick the battery and quantity with the best bill savings, then flip the ranking to size by payback, lifetime
            value, solar self-consumption, a peak-kW target, or backup hours.
          </p>
        </div>
      </header>

      <div className="layout">
        <section className="panel" aria-labelledby="inputs-title">
          <div className="panel-head">
            <h2 id="inputs-title">Inputs</h2>
            <p>The synthetic example runs with no login. Sun Daddy is optional and stays on the worker.</p>
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
              Critical load (kW)
              <input value={criticalKw} onChange={(event) => setCriticalKw(event.target.value)} />
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
            the hourly peak.
          </p>

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
          {model.ok && top ? (
            <>
              <div className="money" data-testid="top-pick">
                <p className="money-kicker">Top pick · {model.mode.label}</p>
                <p className="dollars">
                  {top.quantity} × {top.battery.name}
                </p>
                <p className="rate-line">
                  {money(top.annual_savings_usd)} / yr · payback {years(top.simple_payback_years)} · NPV {money(top.npv_usd)} ·{" "}
                  {money(top.installed_cost_usd)} installed
                </p>
                {unmetPeak ? (
                  <p className="disclaimer">Nothing in the list hits the peak-kW target. This is the closest reduction.</p>
                ) : null}
                {unmetBackup ? (
                  <p className="disclaimer">Nothing in the list covers the backup-hour target. This is the longest backup.</p>
                ) : null}
              </div>
              <SavingsChart series={chartSeries} />
              <div className="table-wrap">
                <table data-testid="comparison-table">
                  <caption>Comparison</caption>
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
                      <th>Backup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.ranked.map((row) => (
                      <tr key={`${row.battery.id}-${row.quantity}`}>
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
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="hint" data-testid="sizer-caveat">
                {(top.warnings.length > 0 ? top.warnings : ["Demand uses the hourly peak unless billed peaks are set."])
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
        usableKwh={top ? top.battery.usable_capacity_kwh * top.quantity : null}
        dischargeKw={top ? top.battery.max_discharge_rate_kw * top.quantity : null}
        aggregateKw={top ? top.battery.max_discharge_rate_kw * top.quantity : null}
        unitKwh={top ? top.battery.usable_capacity_kwh : null}
        unitCount={top ? top.quantity : null}
        customerPeakKw={buildingPeak > 0 ? buildingPeak : null}
      />

      <footer className="footer">
        <p>Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.</p>
      </footer>
    </div>
  );
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
