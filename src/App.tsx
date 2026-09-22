import { useMemo, useState } from "react";
import { IntervalChart, MonthlyChart } from "./components/Charts";
import { InterconnectPanel } from "./components/InterconnectPanel";
import fixtureA from "./fixtures/example-a.snapshot.json";
import { exampleBPeakKw, exampleBPoints, exampleBTargetKw } from "./fixtures/example-b";
import { coveringSnaps } from "./sizing/catalog";
import { GROSS_DEMAND_DISCLAIMER, QUALITY_COPY } from "./sizing/copy";
import { loadCsv } from "./sizing/csv";
import { monthlyGrossTable, peakShaveDemand, sizeBessSnapshot } from "./sizing/engine";
import { buildSnapshotFromForm, type MonthInput } from "./sizing/form";
import { ENERGY_USD_PER_KWH, TARIFF_AS_OF, demandRate, formatUsd } from "./sizing/tariff";
import { TOU_V1 } from "./sizing/tou";
import type { DemandPreview, LoadQuality, MonthGrossRow, SizingResult } from "./sizing/types";

type ReadyModel = {
  ok: true;
  demand: DemandPreview;
  months: MonthInput[];
  monthsTable: MonthGrossRow[];
  result: SizingResult | null;
};

type Model = ReadyModel | { ok: false; error: string };

type MonthRow = {
  id: string;
  startDate: string;
  peak: string;
  kwh: string;
};

const DURATION_PRESETS = [1, 2, 3, 4];

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `month-${rowSeq}`;
}

function monthLabel(startDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(startDate)) return startDate || "Month";
  const date = new Date(`${startDate.slice(0, 10)}T12:00:00`);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function rowsFromSegments(
  segments: { start_date?: string; peak_demand_kw: number; total_kwh?: number }[],
): MonthRow[] {
  return segments.map((segment) => ({
    id: nextRowId(),
    startDate: segment.start_date ?? "",
    peak: String(segment.peak_demand_kw),
    kwh: segment.total_kwh == null ? "" : String(segment.total_kwh),
  }));
}

function sampleMonths(): MonthRow[] {
  return rowsFromSegments(fixtureA.segments);
}

function parseMonths(rows: MonthRow[]): { months: MonthInput[] } | { error: string } {
  const months: MonthInput[] = [];
  for (const row of rows) {
    const blank = row.peak.trim() === "" && row.kwh.trim() === "" && row.startDate.trim() === "";
    if (blank) continue;
    const peakKw = Number(row.peak);
    if (!Number.isFinite(peakKw) || peakKw < 0) {
      return { error: "Monthly peaks must be zero or positive numbers." };
    }
    const totalKwh = row.kwh.trim() === "" ? null : Number(row.kwh);
    if (totalKwh != null && !Number.isFinite(totalKwh)) return { error: "Monthly kWh must be a number." };
    months.push({ startDate: row.startDate, peakKw, totalKwh });
  }
  return { months };
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = Math.ceil(items.length / max);
  return items.filter((_, index) => index % step === 0);
}

export default function App() {
  const [mode, setMode] = useState<"monthly" | "interval">("monthly");
  const [target, setTarget] = useState(String(fixtureA.sizing.target_kw));
  const [months, setMonths] = useState<MonthRow[]>(sampleMonths);
  const [preset, setPreset] = useState<number | null>(null);
  const [customDuration, setCustomDuration] = useState("");
  const [points, setPoints] = useState<{ ts: string; kw: number }[]>([]);
  const [quality, setQuality] = useState<LoadQuality>("RULE_OF_THUMB");
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [note, setNote] = useState(
    "Sample Layton retail months are loaded. Pick a duration preset — a bill does not say how long 220 kW lasted.",
  );
  const [formError, setFormError] = useState<string | null>(null);

  const duration = useMemo(() => {
    if (customDuration.trim() !== "") {
      const parsed = Number(customDuration);
      if (!Number.isFinite(parsed) || parsed <= 0) return "invalid" as const;
      return parsed;
    }
    return preset;
  }, [customDuration, preset]);

  const model = useMemo((): Model => {
    const targetKw = Number(target);
    if (target.trim() === "" || !Number.isFinite(targetKw) || targetKw < 0) {
      return { ok: false, error: "Enter a target kW of zero or more." };
    }
    const parsed = parseMonths(months);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (mode === "monthly" && parsed.months.length === 0) {
      return { ok: false, error: "Add at least one monthly peak, or switch to 15-minute intervals." };
    }
    if (mode === "interval" && points.length === 0) {
      return { ok: false, error: "Upload 15-minute intervals or load an example spike." };
    }
    if (duration === "invalid") return { ok: false, error: "Duration preset must be a number of hours greater than zero." };

    const snapshot = buildSnapshotFromForm({
      mode,
      targetKw,
      months: parsed.months,
      durationHours: typeof duration === "number" ? duration : null,
      points,
      intervalQuality: quality,
      intervalMinutes,
    });

    try {
      const demand = peakShaveDemand(snapshot);
      const monthsTable = mode === "monthly" ? monthlyGrossTable(snapshot) : [];
      const energyReady = mode === "interval" || typeof duration === "number";
      const result: SizingResult | null = energyReady ? sizeBessSnapshot(snapshot) : null;
      return { ok: true, demand, monthsTable, result, months: parsed.months };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not size this load." };
    }
  }, [mode, target, months, duration, points, quality, intervalMinutes]);

  function loadSampleMonthly() {
    setMode("monthly");
    setTarget(String(fixtureA.sizing.target_kw));
    setMonths(sampleMonths());
    setPreset(null);
    setCustomDuration("");
    setNote("Sample monthly bill. Power uses the highest peak. Energy waits on a duration preset (RULE_OF_THUMB).");
    setFormError(null);
  }

  function loadExampleA() {
    setMode("interval");
    setTarget(String(fixtureA.sizing.target_kw));
    setMonths(sampleMonths());
    setPoints(fixtureA.interval_kw_optional.points.map((point) => ({ ts: point.ts, kw: point.kw })));
    setQuality("RULE_OF_THUMB");
    setIntervalMinutes(fixtureA.interval_kw_optional.interval_minutes);
    setNote("Example A is a synthetic retail spike, so quality stays RULE_OF_THUMB. The peak-shave formulas are the locked ones.");
    setFormError(null);
  }

  function loadExampleB() {
    setMode("interval");
    setTarget(String(exampleBTargetKw));
    setMonths(rowsFromSegments([{ start_date: "2026-07-15", peak_demand_kw: exampleBPeakKw, total_kwh: undefined }]));
    setPoints(exampleBPoints.map((point) => ({ ts: point.ts ?? "", kw: point.kw })));
    setQuality("RULE_OF_THUMB");
    setIntervalMinutes(15);
    setNote("Example B is an illustrative warehouse plateau, not a meter file.");
    setFormError(null);
  }

  async function onUpload(file: File) {
    try {
      const text = await file.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("{")) {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") throw new Error("Snapshot must be an object.");
        const snapshot = parsed as {
          sizing?: { target_kw?: number };
          segments?: { start_date?: string; peak_demand_kw: number; total_kwh?: number }[];
          interval_kw_optional?: {
            quality?: LoadQuality;
            interval_minutes?: number;
            points?: { ts?: string; kw: number }[];
          } | null;
        };
        if (snapshot.sizing?.target_kw != null) setTarget(String(snapshot.sizing.target_kw));
        if (snapshot.segments?.length) setMonths(rowsFromSegments(snapshot.segments));
        const uploadedPoints = snapshot.interval_kw_optional?.points ?? [];
        if (uploadedPoints.length > 0) {
          setMode("interval");
          setPoints(uploadedPoints.map((point) => ({ ts: point.ts ?? "", kw: point.kw })));
          setQuality(snapshot.interval_kw_optional?.quality ?? "FACT");
          setIntervalMinutes(snapshot.interval_kw_optional?.interval_minutes ?? 15);
          setNote("Loaded interval snapshot. Export mode is still yours to choose.");
        } else {
          setMode("monthly");
          setNote("Loaded monthly snapshot. Choose a duration preset for usable energy.");
        }
        setFormError(null);
        return;
      }
      const loaded = loadCsv(text);
      if (loaded.kind === "monthly") {
        setMode("monthly");
        setMonths(
          loaded.rows.map((row) => ({
            id: nextRowId(),
            startDate: row.startDate,
            peak: String(row.peakKw),
            kwh: row.totalKwh == null ? "" : String(row.totalKwh),
          })),
        );
        setNote("Monthly CSV loaded. This path is RULE_OF_THUMB until you add measured intervals.");
      } else {
        setMode("interval");
        setPoints(loaded.points);
        setQuality("FACT");
        if (loaded.intervalMinutes) setIntervalMinutes(loaded.intervalMinutes);
        setNote("Interval CSV loaded as measured meter data (FACT). Switch to estimated shape if this file is synthetic.");
      }
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not read that file.");
    }
  }

  const result = model.ok ? model.result : null;
  const demand = model.ok ? model.demand : null;
  const showError = formError ?? (model.ok ? null : model.error);
  const alternates =
    result?.catalog_snap == null
      ? []
      : coveringSnaps(result.e_nameplate_kwh).filter(
          (snap) => snap.pack_kwh !== result.catalog_snap?.pack_kwh || snap.count !== result.catalog_snap.count,
        );
  const chartPoints = downsample(points, 288);
  const otherSeason = demand?.season === "winter" ? demandRate("summer") : demandRate("winter");
  const activeQuality: LoadQuality = result?.quality ?? (mode === "interval" ? quality : "RULE_OF_THUMB");

  return (
    <div className="wrap">
      <header className="mast">
        <div className="mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <rect x="7" y="6" width="18" height="22" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="12" y="3" width="8" height="3" fill="currentColor" />
            <rect x="10" y="16" width="12" height="8" fill="currentColor" />
          </svg>
        </div>
        <div>
          <p className="kicker">Rocky Mountain Power · Utah Schedule 6 · {TARIFF_AS_OF}</p>
          <h1>Battery Bench</h1>
          <p className="lede">
            Commercial peak-shave sizer. Power is the kilowatts you take off the billing peak. Energy is how long that
            peak actually lasts.
          </p>
        </div>
      </header>

      <div className="layout">
        <section className="panel" aria-labelledby="load-title">
          <div className="panel-head">
            <h2 id="load-title">Load</h2>
            <p>Default path is the monthly bill. 15-minute intervals are optional and, when measured, are FACT.</p>
          </div>
          <div className="segmented" role="group" aria-label="Load source">
            <button type="button" aria-pressed={mode === "monthly"} onClick={() => setMode("monthly")}>
              Monthly bill
            </button>
            <button type="button" aria-pressed={mode === "interval"} onClick={() => setMode("interval")}>
              15-minute intervals
            </button>
          </div>
          <p className="quality-copy">{mode === "monthly" ? QUALITY_COPY.RULE_OF_THUMB : QUALITY_COPY[quality]}</p>
          <div className="example-row">
            <button type="button" onClick={loadSampleMonthly}>
              Sample monthly bill
            </button>
            <button type="button" onClick={loadExampleA}>
              Example A spike
            </button>
            <button type="button" onClick={loadExampleB}>
              Example B plateau
            </button>
          </div>
          <label className="target-field">
            Target kW
            <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" />
          </label>
          {mode === "monthly" ? (
            <>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Monthly billing peaks</caption>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Peak kW</th>
                      <th>kWh</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            aria-label={`${monthLabel(row.startDate)} start date`}
                            type="date"
                            value={row.startDate}
                            onChange={(event) =>
                              setMonths((current) =>
                                current.map((item) =>
                                  item.id === row.id ? { ...item, startDate: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${monthLabel(row.startDate)} peak kW`}
                            value={row.peak}
                            inputMode="decimal"
                            onChange={(event) =>
                              setMonths((current) =>
                                current.map((item) => (item.id === row.id ? { ...item, peak: event.target.value } : item)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${monthLabel(row.startDate)} kWh`}
                            value={row.kwh}
                            inputMode="decimal"
                            onChange={(event) =>
                              setMonths((current) =>
                                current.map((item) => (item.id === row.id ? { ...item, kwh: event.target.value } : item)),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setMonths((current) => current.filter((item) => item.id !== row.id))}
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
                  setMonths((current) => [...current, { id: nextRowId(), startDate: "", peak: "", kwh: "" }])
                }
              >
                Add month
              </button>
              <fieldset className="presets">
                <legend>Duration preset (hours above target)</legend>
                <div className="preset-row">
                  {DURATION_PRESETS.map((hours) => (
                    <button
                      type="button"
                      key={hours}
                      aria-pressed={preset === hours && customDuration.trim() === ""}
                      onClick={() => {
                        setPreset(hours);
                        setCustomDuration("");
                      }}
                    >
                      {hours} h
                    </button>
                  ))}
                  <label>
                    Custom
                    <input
                      value={customDuration}
                      inputMode="decimal"
                      placeholder="h"
                      onChange={(event) => setCustomDuration(event.target.value)}
                    />
                  </label>
                </div>
                {typeof duration === "number" && duration > 6 ? (
                  <p className="warn-line">That is a long peak. Confirm the load really stays above the target this long.</p>
                ) : null}
              </fieldset>
            </>
          ) : (
            <>
              <fieldset className="presets">
                <legend>Interval quality</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="interval-quality"
                    checked={quality === "FACT"}
                    onChange={() => setQuality("FACT")}
                  />
                  Measured meter (FACT)
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="interval-quality"
                    checked={quality === "RULE_OF_THUMB"}
                    onChange={() => setQuality("RULE_OF_THUMB")}
                  />
                  Estimated shape (RULE_OF_THUMB)
                </label>
              </fieldset>
              <label>
                Interval length (minutes)
                <input
                  value={String(intervalMinutes)}
                  inputMode="decimal"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) setIntervalMinutes(next);
                  }}
                />
              </label>
              <p className="meta">{points.length === 0 ? "No intervals loaded." : `${points.length} intervals loaded.`}</p>
              {points.length > 0 && points.length <= 16 ? (
                <ul className="point-list">
                  {points.map((point) => (
                    <li key={`${point.ts}-${point.kw}`}>
                      <span>{point.ts ? point.ts.slice(11, 16) : "—"}</span>
                      <span>{point.kw} kW</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <label className="upload">
            Upload CSV or snapshot JSON
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpload(file);
                event.target.value = "";
              }}
            />
          </label>
          <p className="meta">
            Monthly columns: start_date, peak_demand_kw, total_kwh. Interval columns: ts, kw.
          </p>
          {note ? <p className="note">{note}</p> : null}
          {showError ? (
            <p className="warn-line" role="alert">
              {showError}
            </p>
          ) : null}
        </section>

        <section className="panel results" aria-labelledby="result-title">
          <div className="panel-head">
            <h2 id="result-title">Peak shave</h2>
            <p className={`quality quality-${activeQuality}`} data-testid="quality">
              {activeQuality}
            </p>
          </div>
          {demand ? (
            <>
              {mode === "interval" && chartPoints.length > 0 ? (
                <IntervalChart points={chartPoints} targetKw={Number(target) || 0} />
              ) : null}
              {mode === "monthly" && model.ok ? (
                <MonthlyChart
                  months={model.months.map((month) => ({
                    label: monthLabel(month.startDate),
                    peakKw: month.peakKw,
                  }))}
                  targetKw={Number(target) || 0}
                />
              ) : null}
              {chartPoints.length < points.length ? (
                <p className="meta">Chart is downsampled. Energy uses every interval.</p>
              ) : null}
              <dl className="metrics">
                <div>
                  <dt>Billing peak</dt>
                  <dd>{demand.peak_kw} kW</dd>
                </div>
                <div>
                  <dt>Battery power</dt>
                  <dd data-testid="p-batt">{demand.p_batt_kw} kW</dd>
                </div>
                <div>
                  <dt>Usable energy</dt>
                  <dd data-testid="e-usable">
                    {result ? `${result.e_usable_kwh} kWh` : "Needs a duration preset"}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{result ? `${result.duration_h} h` : "—"}</dd>
                </div>
                <div>
                  <dt>Nameplate</dt>
                  <dd data-testid="e-nameplate">{result ? `${result.e_nameplate_kwh} kWh` : "—"}</dd>
                </div>
                <div>
                  <dt>Catalog</dt>
                  <dd data-testid="catalog">
                    {result?.catalog_snap
                      ? `${result.catalog_snap.count} × ${result.catalog_snap.pack_kwh} kWh = ${result.catalog_snap.nameplate_kwh} kWh`
                      : "—"}
                  </dd>
                </div>
              </dl>
              {alternates.length > 0 && result?.catalog_snap ? (
                <p className="meta">
                  Same coverage at {result.catalog_snap.nameplate_kwh} kWh:{" "}
                  {alternates.map((snap) => `${snap.count} × ${snap.pack_kwh} kWh`).join(", ")}.
                </p>
              ) : null}
              <div className="money">
                <p className="money-kicker">
                  Design-month gross demand · {demand.season}
                  {demand.season_assumed ? " (season assumed)" : ""}
                </p>
                <p className="dollars" data-testid="gross-demand">
                  {formatUsd(demand.gross_demand_savings_usd_mo)}
                  <span> / mo</span>
                </p>
                <p className="rate-line" data-testid="rate-as-of">
                  {demand.p_batt_kw} kW × {formatUsd(demand.demand_rate_usd_per_kw_mo)}/kW-mo · facilities{" "}
                  {formatUsd(demand.facilities_usd_per_kw)} + {demand.season} power {formatUsd(demand.power_usd_per_kw)} ·
                  as of {demand.tariff_as_of}
                </p>
                <p className="disclaimer" data-testid="disclaimer">
                  {GROSS_DEMAND_DISCLAIMER}
                </p>
              </div>
              <p className="meta">
                The $58 customer charge does not change with the shave.{" "}
                {otherSeason.season === "summer" ? "Summer" : "Winter"} demand rate is{" "}
                {formatUsd(otherSeason.usdPerKwMo)}/kW-mo (facilities {formatUsd(otherSeason.facilitiesUsdPerKw)} + power{" "}
                {formatUsd(otherSeason.powerUsdPerKw)}).
              </p>
              <p className="meta">
                Schedule 6 is distribution-voltage general service. If this account has registered 1,000 kW more than
                once in the last 18 months, review Schedule 8.
                {demand.peak_kw >= 1000 ? " This peak is in that range." : ""}
              </p>
              {result ? (
                <details className="assumptions">
                  <summary>Nameplate assumptions</summary>
                  <p>
                    E_nameplate = E_usable / ({result.assumptions.soc_window} SOC window ×{" "}
                    {result.assumptions.eta_discharge} discharge efficiency × {result.assumptions.eol_retention}{" "}
                    end-of-life retention). Catalog modules are 40, 60, 80, and 100 kWh, stacked. Ties prefer 60 kWh.
                  </p>
                </details>
              ) : (
                <p className="meta">Nameplate uses an 80% SOC window, 95% discharge efficiency, and 80% end-of-life retention.</p>
              )}
              {model.ok && model.monthsTable.length > 1 ? (
                <div className="table-wrap">
                  <table>
                    <caption>Gross demand by month</caption>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Peak</th>
                        <th>Shave</th>
                        <th>Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.monthsTable.map((row) => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td>{row.peak_kw} kW</td>
                          <td>{row.shave_kw} kW</td>
                          <td>{formatUsd(row.gross_demand_savings_usd_mo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="meta">Each month is priced on its own peak above the target. The headline uses the highest month.</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="pending">Enter a target and a load to size the battery.</p>
          )}
        </section>
      </div>

      <section className="panel tou" data-tou={TOU_V1} aria-labelledby="tou-title">
        <h2 id="tou-title">TOU energy shift</h2>
        <p>
          Not in this version. Peak-shave sizes power and energy for the demand charge only. Energy arbitrage on the
          Schedule 6 energy rates (summer {(ENERGY_USD_PER_KWH.summer * 100).toFixed(4)}¢/kWh, winter{" "}
          {(ENERGY_USD_PER_KWH.winter * 100).toFixed(4)}¢/kWh) is a TODO.
        </p>
      </section>

      <InterconnectPanel
        usableKwh={result?.e_usable_kwh ?? null}
        dischargeKw={demand?.p_batt_kw ?? null}
        aggregateKw={demand?.p_batt_kw ?? null}
        unitKwh={result?.catalog_snap?.pack_kwh ?? null}
        unitCount={result?.catalog_snap?.count ?? null}
        customerPeakKw={demand?.peak_kw ?? null}
      />

      <footer className="footer">
        <p>Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.</p>
      </footer>
    </div>
  );
}
