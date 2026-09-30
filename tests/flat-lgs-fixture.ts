/** Synthetic flat commercial rate. Numbers follow a public tariff shape; this is not a customer bill. */

export function flatLgsModel(): Record<string, unknown> {
  return {
    seasons: [],
    components: [
      { kind: "fixed", label: "Basic Service Charge", rate: 15.8, is_minimum: true },
      { kind: "demand", label: "Facilities Charge", target: "import", value_type: "flat", rate: 4.6 },
      { kind: "demand", label: "Demand", target: "import", value_type: "flat", rate: 5.48 },
      { kind: "energy", label: "Usage", target: "import", value_type: "flat", rate: 0.06746 },
      { kind: "energy", label: "DEAA", target: "import", value_type: "flat", rate: 0.00722 },
      { kind: "energy", label: "TRED", target: "import", value_type: "flat", rate: 0.0002 },
      { kind: "energy", label: "REPR", target: "import", value_type: "flat", rate: -0.00052 },
      { kind: "energy", label: "EE", target: "import", value_type: "flat", rate: 0.00165 },
    ],
    netting: "interval",
    min_bill: 0,
    credit_rollover: "rollover_forfeit",
    export_credit_scope: "full_bill",
    tax_rate: 0,
    true_up_month: null,
    true_up_day: null,
  };
}

export function flatLgsRate(options?: {
  utility?: string | null;
  state?: string | null;
  name?: string | null;
}): Record<string, unknown> {
  const rate: Record<string, unknown> = { model_json: flatLgsModel() };
  const utility = options && "utility" in options ? options.utility : "NVenergy";
  const state = options && "state" in options ? options.state : "NV";
  const name = options && "name" in options ? options.name : "LGS-1";
  if (utility != null) rate.utility = utility;
  if (state != null) rate.state = state;
  if (name != null) rate.name = name;
  return rate;
}
