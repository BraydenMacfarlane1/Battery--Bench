export const DEFAULT_ROUND_TRIP_EFFICIENCY = 0.9;
/** Planning assumption, not a manufacturer warranty. Editable per battery. */
export const DEFAULT_DEGRADATION_PER_YEAR = 0.02;

export const HOURLY_DEMAND_CAVEAT =
  "Demand charges use the hourly average as kW. Fifteen-minute billing peaks are often higher. Provide billed monthly peaks to scale demand charges. Scaling is off until those peaks are provided.";

export const BILLED_PEAK_SCALE_CAVEAT =
  "Billed monthly peaks scale every demand window by billed peak ÷ baseline hourly peak. The battery is assumed to cut the intra-hour peak in the same proportion as the hourly peak. This is not a 15-minute simulation.";

export const MODEL_ASSUMPTIONS = [
  "Each of the 8,760 hours is one hour of a non-leap year. Hour 0 is Monday 00:00 unless a different start weekday is set. kWh during the hour equals average kW.",
  "On-site solar serves the building before the battery. The battery never exports; only unused solar does.",
  "Round-trip efficiency is split evenly. One-way efficiency is the square root, applied when charging and again when discharging.",
  "Usable capacity is the battery's usable kWh. When min_reserve_pct is set, that share is held back before the state-of-charge window. A null reserve removes nothing. The year starts at the bottom of the window, so the bill does not include a free initial charge.",
  "Hourly charge power uses continuous_kw when the catalog sets it, otherwise max charge kW. Hourly discharge power uses peak_kw, then continuous_kw, then max discharge kW. Backup power uses continuous_kw when it is set, otherwise max discharge kW. Peak kW is not treated as power the pack can hold for a whole outage hour.",
  "Demand peak shaving has perfect foresight inside each calendar month and holds the lowest flat grid-import cap the battery can sustain without charging above that cap.",
  "TOU arbitrage charges only in the day's cheapest hours and discharges only in the day's most expensive hours, and only when the spread covers round-trip losses. It offsets on-site load.",
  "The combined strategy holds the peak-shave cap, charges from excess solar, and uses leftover state of charge for TOU arbitrage.",
  "The simulated year uses beginning-of-life usable capacity. Year-by-year degradation is applied in the multi-year cash flows, not by re-dispatching degraded capacity.",
  "If billed monthly peaks are provided, every demand window that month is scaled by billed peak ÷ baseline hourly peak.",
  "Backup duration is a separate hourly outage estimate. It does not change the bill. Its limits are listed with the backup result.",
] as const;
