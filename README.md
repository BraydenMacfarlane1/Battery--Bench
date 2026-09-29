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

## Schedule 6 worksheet

The on-screen worksheet is still the closed-form peak-shave check. It does not run the hourly dispatch. Its time-of-use panel is still a stub.

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
