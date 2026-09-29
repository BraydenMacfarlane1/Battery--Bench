# Battery Bench

Commercial battery sizing worksheet. It is not an engineering stamp or an interconnection approval.

Two tools live here:

- **Hourly dispatch** (`src/dispatch/`) compares a battery stack with the same 8,760-hour load and solar on a tariff you pass in. Savings are baseline bill minus the bill with the battery.
- **Schedule 6 worksheet** (the original screen) is a closed-form peak-shave check for Rocky Mountain Power Utah Schedule 6. That tariff is a built-in example. The hourly engine does not assume it.

## Hourly dispatch model

The engine takes an 8,760-hour load, optional solar, a `RateModel`, and a battery quantity. Each value is kWh during that hour, so it is also the average kW. The series is a non-leap year. Hour 0 is Monday 00:00 unless `start_weekday` is set (0 = Sunday … 6 = Saturday).

### Bill

- **Energy.** Every matching energy period adds its $/kWh. Non-overlapping TOU windows and stacked adders (delivery, surcharges) both work. Hours with no period are $0, and the result says so.
- **Export.** If any matching period sets `export_rate_kwh`, the hour uses the sum of those credits. Otherwise it uses the rate’s `export_credit_kwh`.
- **Demand.** Each component charges its $/kW times the highest hourly grid import inside its window that month. Components stack. A facilities component ignores its hour mask and uses every hour in its months.
- **Fixed, minimum bill, tax.** The fixed charge is added every month. `min_bill_usd` floors the subtotal after export credits. `tax_rate` is a fraction (0.06 = 6%) and applies only to a positive after-minimum subtotal.
- **Savings** = annual baseline bill − annual bill with the battery.

### Battery and dispatch

Usable kWh, charge kW, and discharge kW scale linearly with quantity. Round-trip efficiency defaults to **0.90**. It is split evenly: one-way efficiency is the square root, applied on charge and again on discharge. The state-of-charge window defaults to the full usable range (`soc_min` 0, `soc_max` 1) and is editable. The year starts at the bottom of the window, so savings do not include a free initial charge.

Solar serves the building before the battery. The battery never exports; only unused solar does. Charge and discharge do not happen in the same hour.

Strategies:

| Strategy | Behavior |
|---|---|
| `solar_self_consumption` | Charge only from excess solar. Discharge only into on-site load. |
| `tou_arbitrage` | Charge in the day’s cheapest priced hours. Discharge in the day’s most expensive hours when the spread covers round-trip losses. Looks 24 hours ahead so a late cheap window can serve the next peak. Hours the tariff does not price are left out of the price sort. |
| `demand_peak_shave` | Perfect foresight inside each calendar month. Holds the lowest flat grid-import cap the battery can sustain without charging above that cap. |
| `combined` | Holds that same cap, charges from excess solar, and uses leftover state of charge for TOU arbitrage. |

Degradation defaults to **2% of usable capacity per year**. That is a planning assumption, not a warranty. The single-year dispatch uses beginning-of-life capacity. Multi-year cash flows apply degradation later.

### 15-minute demand

Hourly energy understates a 15-minute billing peak. Pass optional `billed_peak_kw` (12 months, January–December; null skips a month). Every demand window that month is scaled by billed peak ÷ baseline hourly peak. The same scale is used with the battery, which assumes the battery cuts the intra-hour peak in the same proportion. The result includes that caveat. It is not a 15-minute simulation.

### Schedule 6 example

`rmpSchedule6Rate()` rebuilds the stamped Schedule 6 facilities, power, energy, and $58 customer charge already used by the worksheet (as of 2026-08-10, before riders and tax). Callers opt in. Nothing in the simulator falls back to it.

### Sweep and ranking

`sweepBatteries` runs every catalog battery for quantities 1 through N. Installed cost is `cost_per_unit` for the first unit plus `cost_per_additional_unit` after that.

Simple payback is installed cost ÷ first-year savings. It is blank when savings are not positive. Lifetime NPV and IRR use a default **25-year** life, a **6%** discount rate, and a **2%** rate escalator. Those three are planning defaults, not a forecast. Year-y savings scale by `(1 − degradation)^(y−1) × (1 + escalator)^(y−1)`. The cash flow is pre-tax and ignores incentives.

Peak-kW reduction is the drop in the **highest hourly grid peak of the year**, not the worst month. Solar self-consumption is `(solar − export) / solar` with the battery; battery losses of stored solar count as consumed. Equivalent cycles are DC discharge ÷ usable kWh.

Backup hours are a separate outage estimate, not the bill. The outage load is either the whole building profile or backup loads only. Backup loads are a fixed kW, or a percent of each hour of the building (30% is the screen default). The battery starts at a chosen state of charge (default 100%, clamped to the SOC window) and discharges down to the SOC minimum. Deliverable AC energy is that slice of usable kWh times the square root of round-trip efficiency. Discharge stops at the pack's aggregate max discharge kW. If an hour's load is above that limit, the battery cannot carry it: the estimate reports the kilowatt shortfall and how many hours per year exceed the limit, and that outage ends at the hour. Every hour of the year is tried as a start. The run steps forward until the battery is empty, capped at 72 hours. Ranking uses the median of those durations (the headline's "about" figure). The conservative figure is the 10th percentile. Hours at the average load and at the peak hour are reported too, and those two are not capped. Solar during an outage is off unless requested. Counting it is optimistic, because a grid-tied inverter shuts down without islanding-capable equipment. The estimate is hourly, ignores inverter standby losses, and ignores surge or motor-start loads.

Ranking modes are plain objects with a `compare` function: max annual savings (default), best payback, max NPV, max self-consumption, cheapest stack that hits a peak-kW target, and cheapest stack that hits a backup-hour target. If nothing hits the target, the closest reduction or the longest backup is listed first. The detail view can show any catalog battery, including one that misses the target. That choice stays when the ranking mode changes. Reset follows the best pick again.

## Hourly sizer screen

`npm run dev` opens the hourly sizer on a built-in synthetic building, solar shape, and round-number rate. Those prices are not a utility tariff. Sun Daddy search calls the worker routes above. If the export token is missing, the screen says so and the example keeps running.

The screen has six ranking cards, a strategy selector, and editable efficiency, degradation, SOC window, discount rate, escalator, analysis years, max units (1–12), billed-peak calibration, peak-kW target, and backup hours. Backup duration can follow the whole building or backup loads (a percent of each hour, or a fixed kW), with a starting charge and an optional solar credit. A savings-versus-kWh chart shows diminishing returns for each catalog battery. The detail view opens on the best battery and quantity for the active mode, labeled Best for that mode. Choosing another battery and quantity shows that stack's savings, payback, NPV, peak cut, solar self-consumption, monthly bills, peak-day dispatch, and backup estimate, plus the gap versus the current best. The ranking table still lists every option. Load and solar can be pasted or uploaded as 8,760 hourly kWh values. A simple rate form replaces the loaded tariff with off-peak and on-peak energy, a facilities charge, an on-peak demand charge, a fixed charge, and an export credit. The battery table is editable. The interconnect panel stays under the ranking and is prefilled from the battery in the detail view.

## Schedule 6 worksheet

The Schedule 6 tab is still the closed-form peak-shave check. It does not run the hourly dispatch. Its time-of-use panel points at the hourly sizer.

### FACT vs RULE_OF_THUMB

Two load qualities. The badge on the result says which one you are in.

**FACT** — measured 15-minute kW (a meter file or another measured series).

- Battery power: `P_batt = peak − target`, where peak is the highest interval kW.
- Usable energy: `E_usable = Σ max(0, kW − target) × Δt`.
- A partial day is still FACT math, but it can understate the monthly billing peak. The screen says so.

**RULE_OF_THUMB** — the default. Monthly billing segments (or a CSV of them), and any estimated or synthetic interval shape, including the worked examples.

- Battery power still uses the highest monthly peak minus the target.
- A bill does not record how long the peak lasted, so usable energy is `E_usable = P_batt × duration preset`. You pick the hours. The app does not invent a duration.
- Synthetic 15-minute examples stay RULE_OF_THUMB even though they use the interval formula. The file’s quality tag is what counts. Uploaded interval CSVs default to FACT; switch them to estimated shape if the file is not a meter.

Nameplate, either path:

```
E_nameplate = E_usable / (0.80 SOC window × 0.95 discharge efficiency × 0.80 end-of-life retention)
```

The SOC window is 20% to 100%. Catalog modules are 40, 60, 80, and 100 kWh. The snap is the smallest stack of one module size that covers `E_nameplate`. Ties prefer 60 kWh (examples A and B). If 60 kWh is not in the tie, the larger module wins. The stack never lands below the required nameplate.

## Gross demand dollars

The dollar figure is **gross demand only**:

> Gross demand charge only — Schedule 6 facilities plus power (demand), before riders (including Schedule 80), before EMS forecast derate, and before taxes. Not an energy-charge savings figure and not a guaranteed bill credit. Re-stamp from the live Rocky Mountain Power Utah tariff before customer use.

Summer (June–September): facilities **$4.36/kW** + power **$14.49/kW** = **$18.85/kW-mo**.  
Winter (October–May): facilities **$4.36/kW** + power **$12.82/kW** = **$17.18/kW-mo**.

Stamp date: **2026-08-10**. Customer charge is $58/month and does not change when you shave demand. Energy rates (summer 4.0175¢/kWh, winter 3.5527¢/kWh) are shown on the TOU stub and are not in the dollar figure.

Schedule 6 applies when the load has **not** registered 1,000 kW more than once in the preceding 18 months. Otherwise review Schedule 8.

### Worked examples

| | Target | Peak | P_batt | E_usable | Nameplate | Catalog | Summer gross |
|---|---:|---:|---:|---:|---:|---|---:|
| A retail spike | 160 kW | 220 kW | 60 kW | 71.25 kWh | 117.2 kWh | 2 × 60 = 120 kWh | $1,131 |
| B warehouse plateau | 280 kW | 350 kW | 70 kW | 132.5 kWh | 217.9 kWh | 4 × 60 = 240 kWh | $1,319.50 |

`npm test` locks example A, including the $18.85 rate and the 2026-08-10 stamp.

## Interconnect

Utah flag logic lives in `src/interconnect/` (`bess-utah-v1.ts`, the JSON schema, and the flag catalog). Rocky Mountain Power’s interim no-export guidance is a **hint**. The export-mode control starts empty. The app will not select non-export for you. Unknown circuit headroom keeps `interconnect_ready` false.

## Develop

```bash
npm install
npm test
npm run dev
npm run build
```

Load a monthly CSV (`start_date,peak_demand_kw,total_kwh`) or a 15-minute CSV (`ts,kw`). A `sun-daddy.bess-snapshot.v1` JSON file loads the same way. Example A’s snapshot is `src/fixtures/example-a.snapshot.json`.

## Deploy

Worker name: **`bess-sizer`**. Static assets are the Vite build; `/api/*` hits the worker.

```bash
npx wrangler login          # account may be set later
npm run deploy              # build, then wrangler deploy
```

`workers_dev` is on, and `account_id` is not committed. After deploy the site is `https://bess-sizer.<account-subdomain>.workers.dev`.

- `GET /api/health`
- `GET /api/tariff` — stamped rates plus the gross-demand disclaimer
- `POST /api/size` — body is a snapshot; response matches the sizer
- `GET /api/sun-daddy/projects?q=` — proxy to Sun Daddy `GET /api/export/projects`
- `GET /api/sun-daddy/project/:id` — proxy to `GET /api/export/project/:id`, normalized into the hourly model
- `GET /api/sun-daddy/batteries` — proxy to `GET /api/export/batteries`

Sun Daddy auth stays on the worker. `SUN_DADDY_BASE_URL` defaults to `https://commercial-app.pages.dev`. The bearer token is the secret `SUN_DADDY_EXPORT_TOKEN` and is not a wrangler var, not committed, and not sent to the browser. If the secret is missing, those routes return a clear “not configured” error and the rest of the app still loads.

```bash
npx wrangler secret put SUN_DADDY_EXPORT_TOKEN
```

The normalizer reads `schema_version` 1. Economics percents are divided by 100 (`6.0` = 6%). `round_trip_efficiency: null` becomes 0.90. Hourly gaps and monthly-only loads are left empty rather than shaped. Tariffs with tiered energy, percent adders, ambiguous tax, annual true-up, or conflicting delivery and TOU prices return `Could not fully price this tariff.` instead of a guessed rate. Schedule 6 is not the fallback.
