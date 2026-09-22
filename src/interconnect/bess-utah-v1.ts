/**
 * Utah-first commercial BESS sizing card — Zod inputs + flag catalog.
 * Keep in sync with:
 *   bess-utah-v1.schema.json
 *   bess-utah-v1-flags.json
 *
 * Product rules:
 * - Do NOT silently hard-code export_mode = non_export (UI hint only for RMP).
 * - RMP interim no-battery-export → warn via RMP_INTERIM_NO_EXPORT_UNCONFIRMED.
 * - CIRCUIT_HEADROOM_UNKNOWN → fail-closed interconnect_ready.
 * - Fire defaults = IFC/Utah 1207; AHJ_FIRE_UNVERIFIED always warn in v1.
 */
import { z } from "zod";

export const UtilitySchema = z.enum([
  "rmp", "murray", "provo", "st_george", "other_utah",
  "pge", "sce", "smud", "nv_energy", "idaho_power",
]);
export type Utility = z.infer<typeof UtilitySchema>;

export const ProjectTypeSchema = z.enum([
  "new_pv_storage", "storage_addon_existing_pv", "standalone_storage",
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const ExportModeSchema = z.enum([
  "non_export", "limited_export", "export_net_billing",
]);
export type ExportMode = z.infer<typeof ExportModeSchema>;

export const CouplingSchema = z.enum([
  "ac_coupled", "dc_shared_inverter", "dc_separate_inverters",
]);
export type Coupling = z.infer<typeof CouplingSchema>;

export const SchedulePathSchema = z.enum([
  "sched_137_net_billing", "sched_135_136_grandfathered",
  "partial_requirements_other", "unknown",
]);
export type SchedulePath = z.infer<typeof SchedulePathSchema>;

export const NonExportMethodSchema = z.enum([
  "reverse_power", "min_import", "certified_pcs", "other",
]);
export type NonExportMethod = z.infer<typeof NonExportMethodSchema>;

export const SitingSchema = z.enum([
  "indoor", "outdoor_near_exposures", "outdoor_remote",
]);
export type Siting = z.infer<typeof SitingSchema>;

export const ChemistrySchema = z.enum(["li_ion", "other"]);
export type Chemistry = z.infer<typeof ChemistrySchema>;

export const CustomerClassSchema = z.enum(["residential", "non_residential"]);
export type CustomerClass = z.infer<typeof CustomerClassSchema>;

export const FlagSeveritySchema = z.enum(["hard_fail", "warn", "info"]);
export type FlagSeverity = z.infer<typeof FlagSeveritySchema>;

export const FlagCodeSchema = z.enum([
  "RMP_INTERIM_NO_EXPORT_UNCONFIRMED",
  "RMP_INTERIM_NON_EXPORT_DEFAULT_HINT",
  "EXPORT_LIMIT_REQUIRED",
  "NON_EXPORT_METHOD_REQUIRED",
  "PCS_CERT_REQUIRED",
  "RMP_REVERSE_POWER_NOTE",
  "RATINGS_INCOMPLETE",
  "SCHED137_RES_CAP",
  "SCHED137_NONRES_CAP",
  "RMP_PE_STAMP",
  "RMP_RELAY_500",
  "RMP_HIGH_SIDE_2500",
  "RMP_TELEMETRY",
  "RMP_XFMR_OVERSIZE",
  "RMP_XFMR_UNKNOWN",
  "CIRCUIT_HEADROOM_UNKNOWN",
  "CIRCUIT_15PCT_EXCEEDED",
  "LEVEL1_ELIGIBLE",
  "LEVEL2_ELIGIBLE",
  "ADDON_EXCEEDS_PRIOR",
  "ADDON_PRIOR_UNKNOWN",
  "AC_COUPLED_DISCONNECT",
  "DC_SHARED_DISCONNECT_OK",
  "UL1741SB_REQUIRED",
  "UL9540_REQUIRED",
  "UL9540A_FOR_RELIEF",
  "FIRE_PATH_20KWH",
  "GROUP_SIZE_50KWH",
  "SPACING_3FT_DEFAULT",
  "OUTDOOR_CLEARANCE_10FT",
  "OUTDOOR_CLEARANCE_UNKNOWN",
  "MAQ_600KWH",
  "AHJ_FIRE_UNVERIFIED",
  "MURRAY_500KW_CAP",
  "MUNI_BATTERY_ON_DIAGRAM",
  "OTHER_UTAH_UNKNOWN",
  "R746_312_EXPORT_CAPACITY_PENDING",
]);
export type FlagCode = z.infer<typeof FlagCodeSchema>;

export const BessUtahV1InputsBaseSchema = z.object({
  utility: UtilitySchema,
  ahj: z.string().default("unknown"),
  project_type: ProjectTypeSchema,
  export_mode: ExportModeSchema,
  coupling: CouplingSchema,
  schedule_path: SchedulePathSchema.default("unknown"),
  customer_class: CustomerClassSchema.default("non_residential"),
  non_export_method: NonExportMethodSchema.nullable().optional(),
  pcs_cert_id: z.string().min(1).nullable().optional(),
  siting: SitingSchema,
  chemistry: ChemistrySchema,
  pv_kw_dc: z.number().nonnegative().nullable().optional(),
  pv_inverter_kw_ac: z.number().nonnegative().nullable().optional(),
  storage_usable_kwh: z.number().positive(),
  storage_discharge_kw_ac: z.number().positive(),
  storage_charge_kw_ac: z.number().nonnegative().nullable().optional(),
  storage_inverter_kw_ac: z.number().nonnegative().nullable().optional(),
  /** Proposed TOTAL AC inverter nameplate at PCC */
  aggregate_ac_nameplate_kw: z.number().positive(),
  existing_approved_der_kw_ac: z.number().nonnegative().nullable().optional(),
  service_xfmr_kva: z.number().positive().nullable().optional(),
  export_limit_kw: z.number().nonnegative().nullable().optional(),
  clearance_ft: z.number().nonnegative().nullable().optional(),
  unit_kwh: z.number().positive().nullable().optional(),
  unit_count: z.number().int().positive().nullable().optional(),
  customer_peak_kw: z.number().nonnegative().nullable().optional(),
  circuit_peak_kw: z.number().positive().nullable().optional(),
  ul_9540: z.boolean(),
  ul_9540a: z.boolean(),
  ul_1741_sb: z.boolean(),
  claim_9540a_reduced_spacing: z.boolean().default(false),
  claim_maq_variance: z.boolean().default(false),
  /** True only when RMP confirmed interim no-export is NOT applied */
  rmp_battery_export_confirmed: z.boolean().default(false),
  new_inverter_application: z.boolean().default(true),
  battery_on_diagram_ack: z.boolean().default(false),
});

export const BessUtahV1InputsSchema = BessUtahV1InputsBaseSchema.superRefine((v, ctx) => {
  if (v.export_mode === "limited_export" && (v.export_limit_kw == null || v.export_limit_kw <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["export_limit_kw"], message: "limited_export requires export_limit_kw > 0" });
  }
  if ((v.export_mode === "non_export" || v.export_mode === "limited_export") && v.non_export_method == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["non_export_method"], message: "non_export_method required for non_export / limited_export" });
  }
  if (v.non_export_method === "certified_pcs" && !v.pcs_cert_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pcs_cert_id"], message: "pcs_cert_id required when non_export_method=certified_pcs" });
  }
  if (v.project_type === "new_pv_storage" || v.project_type === "storage_addon_existing_pv") {
    if (v.pv_kw_dc == null || v.pv_kw_dc <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pv_kw_dc"], message: "pv_kw_dc required for PV+storage projects" });
    }
    if (v.pv_inverter_kw_ac == null || v.pv_inverter_kw_ac <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pv_inverter_kw_ac"], message: "pv_inverter_kw_ac required for PV+storage projects" });
    }
  }
  if (v.project_type === "storage_addon_existing_pv" && v.existing_approved_der_kw_ac == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["existing_approved_der_kw_ac"], message: "existing_approved_der_kw_ac required for storage addon" });
  }
});
export type BessUtahV1Inputs = z.infer<typeof BessUtahV1InputsSchema>;

export const BessFlagSchema = z.object({
  code: FlagCodeSchema,
  severity: FlagSeveritySchema,
  message: z.string(),
  gate: z.string(),
});
export type BessFlag = z.infer<typeof BessFlagSchema>;

export const RmpExportStatusSchema = z.enum([
  "n/a", "assumed_non_export", "export_confirmed_by_user", "export_warned_unconfirmed",
]);
export type RmpExportStatus = z.infer<typeof RmpExportStatusSchema>;

export const BessUtahV1CardResultSchema = z.object({
  flags: z.array(BessFlagSchema),
  interconnect_ready: z.boolean(),
  fire_ready: z.boolean(),
  export_assumption: ExportModeSchema,
  rmp_export_status: RmpExportStatusSchema,
});
export type BessUtahV1CardResult = z.infer<typeof BessUtahV1CardResultSchema>;

export type FlagCatalogEntry = {
  code: FlagCode;
  severity: FlagSeverity;
  gate: string;
  when: string;
  message: string;
  failClosedInterconnectReady?: boolean;
  always?: boolean;
};

/** Source of truth mirrored from bess-utah-v1-flags.json */
export const BESS_UTAH_V1_FLAG_CATALOG: FlagCatalogEntry[] = [
  {
    "code": "RMP_INTERIM_NO_EXPORT_UNCONFIRMED",
    "severity": "warn",
    "gate": "export",
    "when": "utility == 'rmp' && export_mode != 'non_export' && rmp_battery_export_confirmed != true",
    "message": "PacifiCorp interim battery tech requirements say battery systems shall not export at POI. Exportable sizing is warn-until-confirmed \u2014 confirm with RMP interconnect before treating as approved."
  },
  {
    "code": "RMP_INTERIM_NON_EXPORT_DEFAULT_HINT",
    "severity": "info",
    "gate": "export",
    "when": "utility == 'rmp' && export_mode == 'non_export'",
    "message": "RMP interim path: non-export is the conservative default until RMP confirms otherwise."
  },
  {
    "code": "EXPORT_LIMIT_REQUIRED",
    "severity": "hard_fail",
    "gate": "export",
    "when": "export_mode == 'limited_export' && (export_limit_kw == null || export_limit_kw <= 0)",
    "message": "limited_export requires export_limit_kw > 0."
  },
  {
    "code": "NON_EXPORT_METHOD_REQUIRED",
    "severity": "hard_fail",
    "gate": "export",
    "when": "(export_mode == 'non_export' || export_mode == 'limited_export') && non_export_method == null",
    "message": "Select reverse_power, min_import, certified_pcs, or other."
  },
  {
    "code": "PCS_CERT_REQUIRED",
    "severity": "hard_fail",
    "gate": "export",
    "when": "non_export_method == 'certified_pcs' && (pcs_cert_id == null || pcs_cert_id == '')",
    "message": "PCS cert ID required."
  },
  {
    "code": "RMP_REVERSE_POWER_NOTE",
    "severity": "warn",
    "gate": "export",
    "when": "utility == 'rmp' && export_mode == 'non_export' && non_export_method == 'reverse_power'",
    "message": "Policy 138: trip if real power toward PacifiCorp exceeds transformer losses for >0.5 s \u2014 commission and document."
  },
  {
    "code": "RATINGS_INCOMPLETE",
    "severity": "hard_fail",
    "gate": "ratings",
    "when": "(project_type == 'new_pv_storage' || project_type == 'storage_addon_existing_pv') && (pv_kw_dc == null || pv_inverter_kw_ac == null)",
    "message": "Collect AC nameplate, DC PV capacity, and kWh separately."
  },
  {
    "code": "SCHED137_RES_CAP",
    "severity": "hard_fail",
    "gate": "schedule_137",
    "when": "schedule_path == 'sched_137_net_billing' && customer_class == 'residential' && pv_kw_dc != null && pv_kw_dc > 25",
    "message": "Schedule 137 residential Installed Capacity \u226425 kW DC."
  },
  {
    "code": "SCHED137_NONRES_CAP",
    "severity": "hard_fail",
    "gate": "schedule_137",
    "when": "schedule_path == 'sched_137_net_billing' && customer_class == 'non_residential' && pv_kw_dc != null && pv_kw_dc > 2000",
    "message": "Schedule 137 non-residential Installed Capacity \u22642 MW DC (batteries included as RGF)."
  },
  {
    "code": "RMP_PE_STAMP",
    "severity": "warn",
    "gate": "protection",
    "when": "utility == 'rmp' && aggregate_ac_nameplate_kw >= 250",
    "message": "Policy 138: PE-stamped drawings typically required \u2265250 kW."
  },
  {
    "code": "RMP_RELAY_500",
    "severity": "warn",
    "gate": "protection",
    "when": "utility == 'rmp' && aggregate_ac_nameplate_kw >= 500",
    "message": "Policy 138: utility-grade relay/breaker path at \u2265500 kW aggregate IBR \u2014 expect study/protection scope."
  },
  {
    "code": "RMP_HIGH_SIDE_2500",
    "severity": "warn",
    "gate": "protection",
    "when": "utility == 'rmp' && aggregate_ac_nameplate_kw >= 2500",
    "message": "Policy 138: high-side interrupting device territory \u22652500 kW."
  },
  {
    "code": "RMP_TELEMETRY",
    "severity": "warn",
    "gate": "protection",
    "when": "utility == 'rmp' && aggregate_ac_nameplate_kw >= 3000",
    "message": "Policy 138 telemetry threshold \u22653 MW (possible \u22651 MW \u2014 verify)."
  },
  {
    "code": "RMP_XFMR_OVERSIZE",
    "severity": "hard_fail",
    "gate": "transformer",
    "when": "utility == 'rmp' && service_xfmr_kva != null && customer_class == 'non_residential' && aggregate_ac_nameplate_kw > service_xfmr_kva",
    "message": "Policy 138 \u00a73.9.3: DER >100% service XFMR \u2192 replacement expected."
  },
  {
    "code": "RMP_XFMR_UNKNOWN",
    "severity": "warn",
    "gate": "transformer",
    "when": "utility == 'rmp' && service_xfmr_kva == null && aggregate_ac_nameplate_kw > 0",
    "message": "Service transformer kVA unknown \u2014 cannot run XFMR capacity gate."
  },
  {
    "code": "CIRCUIT_HEADROOM_UNKNOWN",
    "severity": "warn",
    "gate": "circuit_screen",
    "when": "circuit_peak_kw == null",
    "message": "Utah R746-312 15% circuit screen needs utility peak/hosting data. Do not invent headroom. interconnect_ready stays false until data provided or utility confirms.",
    "failClosedInterconnectReady": true
  },
  {
    "code": "CIRCUIT_15PCT_EXCEEDED",
    "severity": "hard_fail",
    "gate": "circuit_screen",
    "when": "circuit_peak_kw != null && aggregate_ac_nameplate_kw > 0.15 * circuit_peak_kw",
    "message": "R746-312 Level screen fail \u2014 study path."
  },
  {
    "code": "LEVEL1_ELIGIBLE",
    "severity": "info",
    "gate": "review_level",
    "when": "aggregate_ac_nameplate_kw <= 25",
    "message": "Likely Level 1 review path (inverter-based \u226425 kW)."
  },
  {
    "code": "LEVEL2_ELIGIBLE",
    "severity": "info",
    "gate": "review_level",
    "when": "aggregate_ac_nameplate_kw > 25 && aggregate_ac_nameplate_kw <= 2000",
    "message": "Likely Level 2 path if screens pass (\u22642 MW)."
  },
  {
    "code": "ADDON_EXCEEDS_PRIOR",
    "severity": "hard_fail",
    "gate": "addon",
    "when": "project_type == 'storage_addon_existing_pv' && existing_approved_der_kw_ac != null && aggregate_ac_nameplate_kw > existing_approved_der_kw_ac",
    "message": "Proposed aggregate exceeds prior approval \u2014 treat as modified interconnect."
  },
  {
    "code": "ADDON_PRIOR_UNKNOWN",
    "severity": "hard_fail",
    "gate": "addon",
    "when": "project_type == 'storage_addon_existing_pv' && existing_approved_der_kw_ac == null",
    "message": "Existing approved DER kW required for addon projects."
  },
  {
    "code": "AC_COUPLED_DISCONNECT",
    "severity": "warn",
    "gate": "coupling",
    "when": "coupling == 'ac_coupled'",
    "message": "AC-coupled battery needs separate AC disconnect (RMP interim / Policy 138 App H)."
  },
  {
    "code": "DC_SHARED_DISCONNECT_OK",
    "severity": "info",
    "gate": "coupling",
    "when": "coupling == 'dc_shared_inverter'",
    "message": "Shared disconnect allowed only when DC-coupled same inverter."
  },
  {
    "code": "UL1741SB_REQUIRED",
    "severity": "hard_fail",
    "gate": "listings",
    "when": "utility == 'rmp' && new_inverter_application == true && ul_1741_sb == false",
    "message": "RMP requires UL 1741 SB for new inverter applications (eff. 6/1/2024)."
  },
  {
    "code": "UL9540_REQUIRED",
    "severity": "hard_fail",
    "gate": "listings",
    "when": "ul_9540 == false",
    "message": "UL 9540 system listing required for permit-ready ESS."
  },
  {
    "code": "UL9540A_FOR_RELIEF",
    "severity": "warn",
    "gate": "listings",
    "when": "(claim_9540a_reduced_spacing == true || claim_maq_variance == true) && ul_9540a == false",
    "message": "Spacing/MAQ relief claims need UL 9540A + AHJ acceptance."
  },
  {
    "code": "FIRE_PATH_20KWH",
    "severity": "warn",
    "gate": "fire",
    "when": "chemistry == 'li_ion' && storage_usable_kwh >= 20",
    "message": "Utah Fire Code: Li-ion \u226520 kWh triggers ESS (Ch.1207) permit path."
  },
  {
    "code": "GROUP_SIZE_50KWH",
    "severity": "warn",
    "gate": "fire",
    "when": "unit_kwh != null && unit_kwh > 50 && !(ul_9540a == true && claim_9540a_reduced_spacing == true)",
    "message": "Default max group 50 kWh without 9540A + AHJ reduction."
  },
  {
    "code": "SPACING_3FT_DEFAULT",
    "severity": "info",
    "gate": "fire",
    "when": "true",
    "message": "Default \u22653 ft between groups and walls unless 9540A + AHJ.",
    "always": true
  },
  {
    "code": "OUTDOOR_CLEARANCE_10FT",
    "severity": "hard_fail",
    "gate": "fire",
    "when": "siting == 'outdoor_near_exposures' && clearance_ft != null && clearance_ft < 10 && claim_9540a_reduced_spacing != true",
    "message": "Default 10 ft to exposures; <10 ft needs listed exception / barrier / 9540A path."
  },
  {
    "code": "OUTDOOR_CLEARANCE_UNKNOWN",
    "severity": "warn",
    "gate": "fire",
    "when": "(siting == 'outdoor_near_exposures' || siting == 'outdoor_remote') && clearance_ft == null",
    "message": "Clearances unknown \u2014 cannot clear footprint gate."
  },
  {
    "code": "MAQ_600KWH",
    "severity": "hard_fail",
    "gate": "fire",
    "when": "chemistry == 'li_ion' && storage_usable_kwh > 600 && claim_maq_variance != true",
    "message": "Default MAQ 600 kWh Li-ion per fire area without HMA/variance."
  },
  {
    "code": "AHJ_FIRE_UNVERIFIED",
    "severity": "warn",
    "gate": "fire",
    "when": "true",
    "message": "Using IFC/Utah 1207 defaults; local FM amendments unverified \u2014 confirm AHJ.",
    "always": true
  },
  {
    "code": "MURRAY_500KW_CAP",
    "severity": "hard_fail",
    "gate": "muni",
    "when": "utility == 'murray' && customer_class == 'non_residential' && aggregate_ac_nameplate_kw > 500",
    "message": "Murray commercial net-metering agreement cap \u2264500 kW."
  },
  {
    "code": "MUNI_BATTERY_ON_DIAGRAM",
    "severity": "hard_fail",
    "gate": "muni",
    "when": "(utility == 'provo' || utility == 'st_george') && battery_on_diagram_ack != true",
    "message": "Battery banks must appear on diagrams/application \u2014 set battery_on_diagram_ack."
  },
  {
    "code": "OTHER_UTAH_UNKNOWN",
    "severity": "warn",
    "gate": "muni",
    "when": "utility == 'other_utah'",
    "message": "Export/PCS/size rules unknown \u2014 verify with utility before interconnect-ready.",
    "failClosedInterconnectReady": true
  },
  {
    "code": "R746_312_EXPORT_CAPACITY_PENDING",
    "severity": "info",
    "gate": "docket",
    "when": "true",
    "message": "Do not assume export-capacity screens replace nameplate \u2014 Docket 23-R312-01 not coded as adopted.",
    "always": true
  }
];

export function rmpExportStatus(input: BessUtahV1Inputs): RmpExportStatus {
  if (input.utility !== "rmp") return "n/a";
  if (input.export_mode === "non_export") return "assumed_non_export";
  if (input.rmp_battery_export_confirmed) return "export_confirmed_by_user";
  return "export_warned_unconfirmed";
}

/** Typed evaluator — preferred over string `when` at runtime. */
export function evaluateBessUtahV1Flags(input: BessUtahV1Inputs): BessUtahV1CardResult {
  const flags: BessFlag[] = [];
  const push = (code: FlagCode, severity: FlagSeverity, gate: string, message: string) =>
    flags.push({ code, severity, message, gate });

  const ac = input.aggregate_ac_nameplate_kw;

  // always-on v1
  push("AHJ_FIRE_UNVERIFIED", "warn", "fire", "Using IFC/Utah 1207 defaults; local FM amendments unverified — confirm AHJ.");
  push("SPACING_3FT_DEFAULT", "info", "fire", "Default ≥3 ft between groups and walls unless 9540A + AHJ.");
  push("R746_312_EXPORT_CAPACITY_PENDING", "info", "docket", "Do not assume export-capacity screens replace nameplate — Docket 23-R312-01 not coded as adopted.");

  if (input.utility === "rmp" && input.export_mode !== "non_export" && !input.rmp_battery_export_confirmed) {
    push("RMP_INTERIM_NO_EXPORT_UNCONFIRMED", "warn", "export", "PacifiCorp interim battery tech requirements say battery systems shall not export at POI. Exportable sizing is warn-until-confirmed — confirm with RMP interconnect before treating as approved.");
  }
  if (input.utility === "rmp" && input.export_mode === "non_export") {
    push("RMP_INTERIM_NON_EXPORT_DEFAULT_HINT", "info", "export", "RMP interim path: non-export is the conservative default until RMP confirms otherwise.");
  }
  if (input.export_mode === "limited_export" && (input.export_limit_kw == null || input.export_limit_kw <= 0)) {
    push("EXPORT_LIMIT_REQUIRED", "hard_fail", "export", "limited_export requires export_limit_kw > 0.");
  }
  if ((input.export_mode === "non_export" || input.export_mode === "limited_export") && input.non_export_method == null) {
    push("NON_EXPORT_METHOD_REQUIRED", "hard_fail", "export", "Select reverse_power, min_import, certified_pcs, or other.");
  }
  if (input.non_export_method === "certified_pcs" && !input.pcs_cert_id) {
    push("PCS_CERT_REQUIRED", "hard_fail", "export", "PCS cert ID required.");
  }
  if (input.utility === "rmp" && input.export_mode === "non_export" && input.non_export_method === "reverse_power") {
    push("RMP_REVERSE_POWER_NOTE", "warn", "export", "Policy 138: trip if real power toward PacifiCorp exceeds transformer losses for >0.5 s — commission and document.");
  }

  const pvNeeded = input.project_type === "new_pv_storage" || input.project_type === "storage_addon_existing_pv";
  if (pvNeeded && (input.pv_kw_dc == null || input.pv_inverter_kw_ac == null)) {
    push("RATINGS_INCOMPLETE", "hard_fail", "ratings", "Collect AC nameplate, DC PV capacity, and kWh separately.");
  }

  if (input.schedule_path === "sched_137_net_billing" && input.customer_class === "residential" && input.pv_kw_dc != null && input.pv_kw_dc > 25) {
    push("SCHED137_RES_CAP", "hard_fail", "schedule_137", "Schedule 137 residential Installed Capacity ≤25 kW DC.");
  }
  if (input.schedule_path === "sched_137_net_billing" && input.customer_class === "non_residential" && input.pv_kw_dc != null && input.pv_kw_dc > 2000) {
    push("SCHED137_NONRES_CAP", "hard_fail", "schedule_137", "Schedule 137 non-residential Installed Capacity ≤2 MW DC (batteries included as RGF).");
  }

  if (input.utility === "rmp" && ac >= 250) push("RMP_PE_STAMP", "warn", "protection", "Policy 138: PE-stamped drawings typically required ≥250 kW.");
  if (input.utility === "rmp" && ac >= 500) push("RMP_RELAY_500", "warn", "protection", "Policy 138: utility-grade relay/breaker path at ≥500 kW aggregate IBR — expect study/protection scope.");
  if (input.utility === "rmp" && ac >= 2500) push("RMP_HIGH_SIDE_2500", "warn", "protection", "Policy 138: high-side interrupting device territory ≥2500 kW.");
  if (input.utility === "rmp" && ac >= 3000) push("RMP_TELEMETRY", "warn", "protection", "Policy 138 telemetry threshold ≥3 MW (possible ≥1 MW — verify).");
  if (input.utility === "rmp" && input.service_xfmr_kva != null && input.customer_class === "non_residential" && ac > input.service_xfmr_kva) {
    push("RMP_XFMR_OVERSIZE", "hard_fail", "transformer", "Policy 138 §3.9.3: DER >100% service XFMR → replacement expected.");
  }
  if (input.utility === "rmp" && input.service_xfmr_kva == null && ac > 0) {
    push("RMP_XFMR_UNKNOWN", "warn", "transformer", "Service transformer kVA unknown — cannot run XFMR capacity gate.");
  }

  if (input.circuit_peak_kw == null) {
    push("CIRCUIT_HEADROOM_UNKNOWN", "warn", "circuit_screen", "Utah R746-312 15% circuit screen needs utility peak/hosting data. Do not invent headroom. interconnect_ready stays false until data provided or utility confirms.");
  } else if (ac > 0.15 * input.circuit_peak_kw) {
    push("CIRCUIT_15PCT_EXCEEDED", "hard_fail", "circuit_screen", "R746-312 Level screen fail — study path.");
  }

  if (ac <= 25) push("LEVEL1_ELIGIBLE", "info", "review_level", "Likely Level 1 review path (inverter-based ≤25 kW).");
  else if (ac <= 2000) push("LEVEL2_ELIGIBLE", "info", "review_level", "Likely Level 2 path if screens pass (≤2 MW).");

  if (input.project_type === "storage_addon_existing_pv") {
    if (input.existing_approved_der_kw_ac == null) {
      push("ADDON_PRIOR_UNKNOWN", "hard_fail", "addon", "Existing approved DER kW required for addon projects.");
    } else if (ac > input.existing_approved_der_kw_ac) {
      push("ADDON_EXCEEDS_PRIOR", "hard_fail", "addon", "Proposed aggregate exceeds prior approval — treat as modified interconnect.");
    }
  }

  if (input.coupling === "ac_coupled") push("AC_COUPLED_DISCONNECT", "warn", "coupling", "AC-coupled battery needs separate AC disconnect (RMP interim / Policy 138 App H).");
  if (input.coupling === "dc_shared_inverter") push("DC_SHARED_DISCONNECT_OK", "info", "coupling", "Shared disconnect allowed only when DC-coupled same inverter.");

  if (input.utility === "rmp" && input.new_inverter_application && !input.ul_1741_sb) {
    push("UL1741SB_REQUIRED", "hard_fail", "listings", "RMP requires UL 1741 SB for new inverter applications (eff. 6/1/2024).");
  }
  if (!input.ul_9540) push("UL9540_REQUIRED", "hard_fail", "listings", "UL 9540 system listing required for permit-ready ESS.");
  if ((input.claim_9540a_reduced_spacing || input.claim_maq_variance) && !input.ul_9540a) {
    push("UL9540A_FOR_RELIEF", "warn", "listings", "Spacing/MAQ relief claims need UL 9540A + AHJ acceptance.");
  }

  if (input.chemistry === "li_ion" && input.storage_usable_kwh >= 20) {
    push("FIRE_PATH_20KWH", "warn", "fire", "Utah Fire Code: Li-ion ≥20 kWh triggers ESS (Ch.1207) permit path.");
  }
  if (input.unit_kwh != null && input.unit_kwh > 50 && !(input.ul_9540a && input.claim_9540a_reduced_spacing)) {
    push("GROUP_SIZE_50KWH", "warn", "fire", "Default max group 50 kWh without 9540A + AHJ reduction.");
  }
  if (input.siting === "outdoor_near_exposures" && input.clearance_ft != null && input.clearance_ft < 10 && !input.claim_9540a_reduced_spacing) {
    push("OUTDOOR_CLEARANCE_10FT", "hard_fail", "fire", "Default 10 ft to exposures; <10 ft needs listed exception / barrier / 9540A path.");
  }
  if ((input.siting === "outdoor_near_exposures" || input.siting === "outdoor_remote") && input.clearance_ft == null) {
    push("OUTDOOR_CLEARANCE_UNKNOWN", "warn", "fire", "Clearances unknown — cannot clear footprint gate.");
  }
  if (input.chemistry === "li_ion" && input.storage_usable_kwh > 600 && !input.claim_maq_variance) {
    push("MAQ_600KWH", "hard_fail", "fire", "Default MAQ 600 kWh Li-ion per fire area without HMA/variance.");
  }

  if (input.utility === "murray" && input.customer_class === "non_residential" && ac > 500) {
    push("MURRAY_500KW_CAP", "hard_fail", "muni", "Murray commercial net-metering agreement cap ≤500 kW.");
  }
  if ((input.utility === "provo" || input.utility === "st_george") && !input.battery_on_diagram_ack) {
    push("MUNI_BATTERY_ON_DIAGRAM", "hard_fail", "muni", "Battery banks must appear on diagrams/application — set battery_on_diagram_ack.");
  }
  if (input.utility === "other_utah") {
    push("OTHER_UTAH_UNKNOWN", "warn", "muni", "Export/PCS/size rules unknown — verify with utility before interconnect-ready.");
  }

  const hasHardFail = flags.some((f) => f.severity === "hard_fail");
  const failClosed = flags.some((f) => f.code === "CIRCUIT_HEADROOM_UNKNOWN" || f.code === "OTHER_UTAH_UNKNOWN");
  const interconnect_ready = !(hasHardFail || failClosed);
  const fire_ready = !flags.some((f) => f.severity === "hard_fail" && (f.gate === "fire" || f.code === "UL9540_REQUIRED"));

  return {
    flags,
    interconnect_ready,
    fire_ready,
    export_assumption: input.export_mode,
    rmp_export_status: rmpExportStatus(input),
  };
}
