# Pokoks

A price dashboard for Malaysian agriculture and horticulture, built on official open data.
It tracks palm oil from mill gate to shop shelf, daily prices for 119 fresh produce items,
and the national crop statistics behind them.

Everything is a static React app. There is no backend and no API key: two scripts pull the
data into JSON files, and the app reads those.

## What it does

**Sawit (palm)** — Daily Malaysian crude palm oil prices with a 30 day forecast, an
indicative fresh fruit bunch farmgate price, gross income per hectare for a smallholder, and
the refining-and-retail margin between mill gate and a bottle of cooking oil.

**Harga (prices)** — Every fruit, vegetable, rice, egg, onion, bean and spice item in the
PriceCatcher survey. Sort by price, movement or survey coverage. Open any item for daily
history, a wet-market-versus-retail comparison, a state breakdown, a forecast and a table.

**Ladang (farms)** — Crop production and planted area by state, crop type and species, plus
how many premises actually report prices in each state.

**Sumber (sources)** — Where every number comes from, what the survey covers, and the
limits worth knowing before you trust a figure.

## Getting started

```bash
npm install
npm run data:all   # downloads and builds public/data (takes a few minutes)
npm run dev
```

`npm run data:all` writes about 6 MB into `public/data`. That directory is generated and
git-ignored, so anyone cloning the repo runs it once before `npm run dev`.

| Script | What it does |
| --- | --- |
| `npm run data` | PriceCatcher price records plus the DOSM crop tables |
| `npm run data:palm` | MPOB daily crude palm oil prices |
| `npm run data:all` | both of the above |
| `npm run dev` | Vite dev server |
| `npm run build` | production build into `dist` |
| `npm run typecheck` | TypeScript, no emit |

`npm run data` accepts `--months N` to change how much price history is pulled, default 6.
`npm run data:palm` accepts `--range 1M|3M|6M`, plus `--oer` and `--milling` to change the
fresh fruit bunch assumptions described below.

## Data sources

| Source | Used for | Licence |
| --- | --- | --- |
| [PriceCatcher](https://open.dosm.gov.my/data-catalogue/pricecatcher) (KPDN, published via DOSM) | Daily retail and wet market prices | CC BY 4.0 |
| [Crop Area & Production by State](https://open.dosm.gov.my/data-catalogue/crops_state) (DOSM) | National and state crop output | CC BY 4.0 |
| [Crop Production by District](https://open.dosm.gov.my/data-catalogue/crops_district_production) (DOSM) | Output by species | CC BY 4.0 |
| [MPOB](https://bepi.mpob.gov.my) | Daily crude palm oil price | See MPOB terms |

PriceCatcher ships as monthly Parquet files of roughly two million rows each. The build
script streams six months of them, keeps only agriculture and horticulture items, and
aggregates to one row per item per day.

## Things worth knowing

**Fresh fruit bunch prices are derived, not official.** MPOB publishes an official reference
price at 1% oil extraction rate, but not in a machine-readable form. This app estimates the
farmgate price as `crude palm oil price × oil extraction rate × grower share`, defaulting to
19.5% and 72%. Both are flags on `scripts/fetch-palm.mjs`. Check the result against a real
mill statement before relying on it.

**There are no wholesale prices.** Only fifteen wholesale premises are in the PriceCatcher
register and none of them report any tracked crop, so the wet market average stands in as
the closest available farmgate reference.

**Forecasts extrapolate, they do not explain.** Damped-trend exponential smoothing fitted on
past prices alone, with a hold-out backtest whose error is shown next to every projection.
It knows nothing about weather, export duty, festival demand or world vegetable oil markets.

**Crop statistics lag prices by years.** Prices are daily; the agriculture census is annual
and currently ends at 2022.

**Some prices are controlled.** The subsidised 1 kg cooking oil packet sells at a government
ceiling, so it is excluded from the retail average and reported separately.

## Project layout

```
scripts/build-data.mjs   PriceCatcher + DOSM crop tables -> public/data
scripts/fetch-palm.mjs   MPOB crude palm oil prices -> public/data/palm.json
src/lib/forecast.ts      Damped-trend smoothing, prediction intervals, backtest
src/lib/format.ts        Ringgit, percentage and Bahasa Malaysia label formatting
src/components/          Panels, charts and shared primitives
```

## Licence

Code is MIT. The data keeps the licence of its source, listed above. Attribute DOSM and MPOB
if you republish figures.
