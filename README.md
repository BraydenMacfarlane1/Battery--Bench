# Battery Bench

Commercial battery energy storage (BESS) peak-shave sizer for Rocky Mountain Power Utah **Schedule 6** (General Service – Distribution Voltage).

v1 sizes **peak shave only**. Time-of-use energy shift is a TODO. The app is a worksheet, not an engineering stamp or an interconnection approval.

## FACT vs RULE_OF_THUMB

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
