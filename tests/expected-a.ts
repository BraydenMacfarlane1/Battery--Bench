import type { SizingResult } from "../src/sizing/types";

/** Locked worked example A — retail HVAC spike, RMP Schedule 6, as of 2026-08-10. */
export const expectedExampleA: SizingResult = {
  method: "peak_shave_area_above_threshold",
  quality: "RULE_OF_THUMB",
  p_batt_kw: 60,
  e_usable_kwh: 71.25,
  e_nameplate_kwh: 117.2,
  duration_h: 1.19,
  catalog_snap: { pack_kwh: 60, count: 2, nameplate_kwh: 120 },
  demand_rate_usd_per_kw_mo: 18.85,
  gross_demand_savings_usd_mo: 1131,
  assumptions: {
    soc_window: 0.8,
    eta_discharge: 0.95,
    eol_retention: 0.8,
    tariff_as_of: "2026-08-10",
    schedule: "RMP_UT_6",
  },
  flags: [
    "synthetic_interval_fixture",
    "outdoor_setback_default_10ft_confirm_AHJ",
    "not_a_code_or_engineering_stamp",
  ],
};
