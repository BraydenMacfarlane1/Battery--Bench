import { describe, expect, it } from "vitest";
import { evaluateBessUtahV1Flags, type BessUtahV1Inputs } from "../src/interconnect";

function card(overrides: Partial<BessUtahV1Inputs> = {}) {
  const input: BessUtahV1Inputs = {
    utility: "rmp",
    ahj: "unknown",
    project_type: "standalone_storage",
    export_mode: "export_net_billing",
    coupling: "ac_coupled",
    schedule_path: "unknown",
    customer_class: "non_residential",
    siting: "indoor",
    chemistry: "li_ion",
    storage_usable_kwh: 71.25,
    storage_discharge_kw_ac: 60,
    aggregate_ac_nameplate_kw: 60,
    ul_9540: true,
    ul_9540a: false,
    ul_1741_sb: true,
    claim_9540a_reduced_spacing: false,
    claim_maq_variance: false,
    rmp_battery_export_confirmed: false,
    new_inverter_application: true,
    battery_on_diagram_ack: false,
    circuit_peak_kw: null,
    ...overrides,
  };
  return { input, result: evaluateBessUtahV1Flags(input) };
}

describe("Utah interconnect flags", () => {
  it("does not rewrite export mode to non-export", () => {
    const { input, result } = card();
    expect(result.export_assumption).toBe(input.export_mode);
    expect(result.export_assumption).toBe("export_net_billing");
    expect(result.rmp_export_status).toBe("export_warned_unconfirmed");
    expect(result.flags.some((flag) => flag.code === "RMP_INTERIM_NO_EXPORT_UNCONFIRMED")).toBe(true);
    expect(result.flags.some((flag) => flag.code === "RMP_INTERIM_NON_EXPORT_DEFAULT_HINT")).toBe(false);
  });

  it("fail-closes interconnect readiness when circuit headroom is unknown", () => {
    const { result } = card();
    expect(result.flags.some((flag) => flag.code === "CIRCUIT_HEADROOM_UNKNOWN")).toBe(true);
    expect(result.interconnect_ready).toBe(false);
  });

  it("can be interconnect-ready once circuit data is provided and export was chosen", () => {
    const { result } = card({ circuit_peak_kw: 10000, service_xfmr_kva: 500 });
    expect(result.interconnect_ready).toBe(true);
    expect(result.fire_ready).toBe(true);
  });

  it("treats non-export as a user choice and still requires a method", () => {
    const { result } = card({ export_mode: "non_export", circuit_peak_kw: 10000 });
    expect(result.export_assumption).toBe("non_export");
    expect(result.rmp_export_status).toBe("assumed_non_export");
    expect(result.flags.some((flag) => flag.code === "RMP_INTERIM_NON_EXPORT_DEFAULT_HINT")).toBe(true);
    expect(result.flags.some((flag) => flag.code === "NON_EXPORT_METHOD_REQUIRED")).toBe(true);
    expect(result.interconnect_ready).toBe(false);
  });
});
