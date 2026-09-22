import { useEffect, useMemo, useState } from "react";
import {
  evaluateBessUtahV1Flags,
  type BessUtahV1Inputs,
  type ExportMode,
  type Utility,
} from "../interconnect";
import { RMP_NON_EXPORT_HINT } from "../sizing/copy";

type Props = {
  usableKwh: number | null;
  dischargeKw: number | null;
  aggregateKw: number | null;
  unitKwh: number | null;
  unitCount: number | null;
  customerPeakKw: number | null;
};

const UTILITIES: { value: Utility; label: string }[] = [
  { value: "rmp", label: "Rocky Mountain Power" },
  { value: "murray", label: "Murray" },
  { value: "provo", label: "Provo" },
  { value: "st_george", label: "St. George" },
  { value: "other_utah", label: "Other Utah" },
  { value: "pge", label: "PG&E" },
  { value: "sce", label: "SCE" },
  { value: "smud", label: "SMUD" },
  { value: "nv_energy", label: "NV Energy" },
  { value: "idaho_power", label: "Idaho Power" },
];

function positive(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function optionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function InterconnectPanel(props: Props) {
  const [utility, setUtility] = useState<Utility>("rmp");
  const [projectType, setProjectType] = useState<BessUtahV1Inputs["project_type"]>("standalone_storage");
  const [exportMode, setExportMode] = useState<ExportMode | "">("");
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [nonExportMethod, setNonExportMethod] = useState<NonNullable<BessUtahV1Inputs["non_export_method"]> | "">("");
  const [exportLimit, setExportLimit] = useState("");
  const [pcsCertId, setPcsCertId] = useState("");
  const [coupling, setCoupling] = useState<BessUtahV1Inputs["coupling"]>("ac_coupled");
  const [siting, setSiting] = useState<BessUtahV1Inputs["siting"]>("outdoor_near_exposures");
  const [clearance, setClearance] = useState("10");
  const [chemistry, setChemistry] = useState<BessUtahV1Inputs["chemistry"]>("li_ion");
  const [ul9540, setUl9540] = useState(true);
  const [ul9540a, setUl9540a] = useState(false);
  const [ul1741, setUl1741] = useState(true);
  const [batteryOnDiagram, setBatteryOnDiagram] = useState(false);
  const [ahj, setAhj] = useState("unknown");
  const [circuitPeak, setCircuitPeak] = useState("");
  const [xfmr, setXfmr] = useState("");
  const [usable, setUsable] = useState(() => props.usableKwh?.toString() ?? "");
  const [discharge, setDischarge] = useState(() => props.dischargeKw?.toString() ?? "");
  const [aggregate, setAggregate] = useState(() => props.aggregateKw?.toString() ?? "");
  const [unitKwh, setUnitKwh] = useState(() => props.unitKwh?.toString() ?? "");
  const [unitCount, setUnitCount] = useState(() => props.unitCount?.toString() ?? "");
  const [customerPeak, setCustomerPeak] = useState(() => props.customerPeakKw?.toString() ?? "");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    if (props.usableKwh != null) setUsable(String(props.usableKwh));
    if (props.dischargeKw != null) setDischarge(String(props.dischargeKw));
    if (props.aggregateKw != null) setAggregate(String(props.aggregateKw));
    if (props.unitKwh != null) setUnitKwh(String(props.unitKwh));
    if (props.unitCount != null) setUnitCount(String(props.unitCount));
    if (props.customerPeakKw != null) setCustomerPeak(String(props.customerPeakKw));
  }, [
    touched,
    props.usableKwh,
    props.dischargeKw,
    props.aggregateKw,
    props.unitKwh,
    props.unitCount,
    props.customerPeakKw,
  ]);

  function applySizing() {
    if (props.usableKwh != null) setUsable(String(props.usableKwh));
    if (props.dischargeKw != null) setDischarge(String(props.dischargeKw));
    if (props.aggregateKw != null) setAggregate(String(props.aggregateKw));
    if (props.unitKwh != null) setUnitKwh(String(props.unitKwh));
    if (props.unitCount != null) setUnitCount(String(props.unitCount));
    if (props.customerPeakKw != null) setCustomerPeak(String(props.customerPeakKw));
    setTouched(false);
  }

  const card = useMemo(() => {
    if (!exportMode) return null;
    const usableKwh = positive(usable);
    const dischargeKw = positive(discharge);
    const aggregateKw = positive(aggregate);
    if (usableKwh == null || dischargeKw == null || aggregateKw == null) return null;
    const input: BessUtahV1Inputs = {
      utility,
      ahj: ahj.trim() || "unknown",
      project_type: projectType,
      export_mode: exportMode,
      coupling,
      schedule_path: "unknown",
      customer_class: "non_residential",
      non_export_method: nonExportMethod || null,
      pcs_cert_id: pcsCertId.trim() || null,
      siting,
      chemistry,
      storage_usable_kwh: usableKwh,
      storage_discharge_kw_ac: dischargeKw,
      aggregate_ac_nameplate_kw: aggregateKw,
      service_xfmr_kva: positive(xfmr),
      export_limit_kw: optionalNumber(exportLimit),
      clearance_ft: optionalNumber(clearance),
      unit_kwh: positive(unitKwh),
      unit_count: positive(unitCount) == null ? null : Math.round(positive(unitCount) as number),
      customer_peak_kw: optionalNumber(customerPeak),
      circuit_peak_kw: positive(circuitPeak),
      ul_9540: ul9540,
      ul_9540a: ul9540a,
      ul_1741_sb: ul1741,
      claim_9540a_reduced_spacing: false,
      claim_maq_variance: false,
      rmp_battery_export_confirmed: exportConfirmed,
      new_inverter_application: true,
      battery_on_diagram_ack: batteryOnDiagram,
    };
    return evaluateBessUtahV1Flags(input);
  }, [
    exportMode,
    usable,
    discharge,
    aggregate,
    utility,
    ahj,
    projectType,
    coupling,
    nonExportMethod,
    pcsCertId,
    siting,
    chemistry,
    xfmr,
    exportLimit,
    clearance,
    unitKwh,
    unitCount,
    customerPeak,
    circuitPeak,
    ul9540,
    ul9540a,
    ul1741,
    exportConfirmed,
    batteryOnDiagram,
  ]);

  const needsMethod = exportMode === "non_export" || exportMode === "limited_export";

  return (
    <section className="panel interconnect" aria-labelledby="interconnect-title">
      <div className="panel-head">
        <h2 id="interconnect-title">Utah interconnect check</h2>
        <p>Flags from the v1 Utah card. Circuit headroom stays fail-closed until you enter a utility peak.</p>
      </div>
      {utility === "rmp" ? (
        <p className="hint" id="export-hint">
          {RMP_NON_EXPORT_HINT}
        </p>
      ) : null}
      {utility === "murray" ? (
        <p className="hint">Murray’s commercial net-metering agreement caps projects at 500 kW.</p>
      ) : null}
      <div className="form-grid">
        <label>
          Utility
          <select value={utility} onChange={(event) => setUtility(event.target.value as Utility)}>
            {UTILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select
            value={projectType}
            onChange={(event) => setProjectType(event.target.value as BessUtahV1Inputs["project_type"])}
          >
            <option value="standalone_storage">Standalone storage</option>
            <option value="new_pv_storage">New PV + storage</option>
            <option value="storage_addon_existing_pv">Storage add-on</option>
          </select>
        </label>
        <label>
          Export mode
          <select
            id="export-mode"
            data-testid="export-mode"
            aria-describedby={utility === "rmp" ? "export-hint" : undefined}
            value={exportMode}
            onChange={(event) => setExportMode(event.target.value as ExportMode | "")}
          >
            <option value="">Select export mode</option>
            <option value="non_export">Non-export</option>
            <option value="limited_export">Limited export</option>
            <option value="export_net_billing">Export / net billing</option>
          </select>
        </label>
        <label>
          Coupling
          <select
            value={coupling}
            onChange={(event) => setCoupling(event.target.value as BessUtahV1Inputs["coupling"])}
          >
            <option value="ac_coupled">AC coupled</option>
            <option value="dc_shared_inverter">DC shared inverter</option>
            <option value="dc_separate_inverters">DC separate inverters</option>
          </select>
        </label>
        <label>
          Siting
          <select value={siting} onChange={(event) => setSiting(event.target.value as BessUtahV1Inputs["siting"])}>
            <option value="outdoor_near_exposures">Outdoor, near exposures</option>
            <option value="outdoor_remote">Outdoor, remote</option>
            <option value="indoor">Indoor</option>
          </select>
        </label>
        <label>
          Clearance (ft)
          <input value={clearance} onChange={(event) => setClearance(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          Usable kWh
          <input
            value={usable}
            onChange={(event) => {
              setTouched(true);
              setUsable(event.target.value);
            }}
            inputMode="decimal"
          />
        </label>
        <label>
          Discharge kW
          <input
            value={discharge}
            onChange={(event) => {
              setTouched(true);
              setDischarge(event.target.value);
            }}
            inputMode="decimal"
          />
        </label>
        <label>
          Aggregate AC kW
          <input
            value={aggregate}
            onChange={(event) => {
              setTouched(true);
              setAggregate(event.target.value);
            }}
            inputMode="decimal"
          />
        </label>
        <label>
          Circuit peak kW
          <input
            value={circuitPeak}
            onChange={(event) => setCircuitPeak(event.target.value)}
            inputMode="decimal"
            placeholder="Unknown"
          />
        </label>
        <label>
          Service transformer kVA
          <input value={xfmr} onChange={(event) => setXfmr(event.target.value)} inputMode="decimal" placeholder="Unknown" />
        </label>
        <label>
          AHJ
          <input value={ahj} onChange={(event) => setAhj(event.target.value)} />
        </label>
      </div>
      {needsMethod ? (
        <label className="span-field">
          Non-export method
          <select
            value={nonExportMethod}
            onChange={(event) =>
              setNonExportMethod(event.target.value as NonNullable<BessUtahV1Inputs["non_export_method"]> | "")
            }
          >
            <option value="">Select method</option>
            <option value="reverse_power">Reverse power</option>
            <option value="min_import">Minimum import</option>
            <option value="certified_pcs">Certified PCS</option>
            <option value="other">Other</option>
          </select>
        </label>
      ) : null}
      {exportMode === "limited_export" ? (
        <label className="span-field">
          Export limit kW
          <input value={exportLimit} onChange={(event) => setExportLimit(event.target.value)} inputMode="decimal" />
        </label>
      ) : null}
      {nonExportMethod === "certified_pcs" ? (
        <label className="span-field">
          PCS cert ID
          <input value={pcsCertId} onChange={(event) => setPcsCertId(event.target.value)} />
        </label>
      ) : null}
      {utility === "rmp" && exportMode && exportMode !== "non_export" ? (
        <label className="check">
          <input
            type="checkbox"
            checked={exportConfirmed}
            onChange={(event) => setExportConfirmed(event.target.checked)}
          />
          RMP confirmed this project may export
        </label>
      ) : null}
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={ul9540} onChange={(event) => setUl9540(event.target.checked)} />
          UL 9540 listed
        </label>
        <label className="check">
          <input type="checkbox" checked={ul9540a} onChange={(event) => setUl9540a(event.target.checked)} />
          UL 9540A
        </label>
        <label className="check">
          <input type="checkbox" checked={ul1741} onChange={(event) => setUl1741(event.target.checked)} />
          UL 1741 SB
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={batteryOnDiagram}
            onChange={(event) => setBatteryOnDiagram(event.target.checked)}
          />
          Battery shown on the diagram
        </label>
        <label className="check">
          Chemistry
          <select value={chemistry} onChange={(event) => setChemistry(event.target.value as BessUtahV1Inputs["chemistry"])}>
            <option value="li_ion">Lithium-ion</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <button type="button" className="text-button" onClick={applySizing}>
        Fill ratings from sizing
      </button>
      {card ? (
        <div className="ready-row">
          <p className={card.interconnect_ready ? "pill ready" : "pill blocked"}>
            Interconnect {card.interconnect_ready ? "ready" : "not ready"}
          </p>
          <p className={card.fire_ready ? "pill ready" : "pill blocked"}>Fire {card.fire_ready ? "ready" : "not ready"}</p>
          <p className="pill quiet">Export assumption: {card.export_assumption}</p>
          <p className="pill quiet">RMP export status: {card.rmp_export_status}</p>
        </div>
      ) : (
        <p className="pending">Choose an export mode and keep usable kWh, discharge kW, and aggregate AC kW filled in.</p>
      )}
      {card ? (
        <ul className="flags">
          {card.flags.map((flag) => (
            <li key={flag.code} className={`flag flag-${flag.severity}`}>
              <span className="flag-sev">{flag.severity.replace("_", " ")}</span>
              <span className="flag-code">{flag.code}</span>
              <span>{flag.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
