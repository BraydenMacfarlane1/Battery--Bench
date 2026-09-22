/**
 * Shown next to every gross demand dollar figure in the app and on GET /api/tariff.
 * Schedule 6 facilities + power only. Riders, EMS derate, and tax stay outside v1.
 */
export const GROSS_DEMAND_DISCLAIMER =
  "Gross demand charge only — Schedule 6 facilities plus power (demand), before riders (including Schedule 80), before EMS forecast derate, and before taxes. Not an energy-charge savings figure and not a guaranteed bill credit. Re-stamp from the live Rocky Mountain Power Utah tariff before customer use.";

export const QUALITY_COPY = {
  FACT: "Measured 15-minute kW. Usable energy is the area above the target: each interval’s excess kW times its duration.",
  RULE_OF_THUMB:
    "Monthly peaks, or an estimated shape. Usable energy is battery kW times a duration preset, because a bill does not record how long the peak lasted.",
} as const;

export const RMP_NON_EXPORT_HINT =
  "Rocky Mountain Power's interim battery requirements say systems shall not export at the point of interconnection. Non-export is the conservative choice until RMP confirms otherwise. This is a hint only — Battery Bench will not select it for you.";
