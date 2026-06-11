# Evidence — block8_wave2a_forecasting_foundation

**Date:** 2026-06-10
**Project:** The Chain
**Phase:** 6 (Features) · Block 8 (Demand forecasting) · Tranche C wave 2a
**Unit:** Forecasting brain — eligibility + method routing (TS) + the Python `statsforecast` function

---

## Goal

The forecasting foundation everything else hangs off: decide per SKU how much history exists
(eligibility) and which model fits the demand shape (routing), and stand up the stateless Python
function that actually forecasts. The durable batch (2b) and the forecast chart (2c, the visible
payoff) build on this. Researched against current docs first (Vercel Python functions + Nixtla
`statsforecast`) per the outdated-training-data rule.

## What was built

1. **Routing + eligibility** (`src/lib/forecast/routing.ts`, pure): `eligibility(firstSaleAt, now)` →
   cold (<30d) / warming (30–89d) / warm (90+d); `routeForecast({state, adi, cv2})` → `croston_sba`
   (intermittent, ADI ≥ 1.32) / `auto_ets` (smooth) / `auto_arima` (erratic) / `benchmark` (cold or
   no signal). **Reuses the ADI/CV² the Block 7 classification already computes** + its
   `INTERMITTENT_ADI` constant, so the demand-shape math lives in one place.

2. **Python forecast function** (`api/forecast/index.py`, top-level `/api` — runs independently of
   Next's `src/app/api`, confirmed via Vercel docs): `BaseHTTPRequestHandler.do_POST`, stateless, no
   DB. Builds the long-format frame, runs the routed model + a `SeasonalNaive` baseline, backtests
   both with rolling-origin `cross_validation` (RMSSE scaled by the in-sample naive MSE; WAPE), and
   returns forecast points with 80/95% intervals (`ConformalIntervals` for the intermittent models,
   native for ETS/ARIMA), `beats_baseline`, and `n_obs`. `requirements.txt` pins `statsforecast~=2.0`.

## Tests

- `tests/forecast/routing.test.ts` (10): eligibility ladder (no-sales / <30 / 30–89 / 90+ / threshold
  flags) + routing (cold→benchmark, null-adi→benchmark, intermittent→croston_sba, smooth→auto_ets,
  erratic→auto_arima).
- Full suite **341 passed / 46 files**. `tsc --noEmit` clean. `biome check src` clean. `next build`
  clean (the `.py` is outside `src` and doesn't touch the Next build). `python3 -m ast` parse OK.

## Honest scope notes

- **Foundation wave — no new screen.** The visible-craft element is the forecast chart (wave 2c). This
  slice is the engine; not dressed up as a visual release.
- **Python function is syntax-checked + the TS routing/eligibility is fully unit-tested; the
  function's RUNTIME is not yet verified.** No pytest harness in this TS repo and `statsforecast`
  (numba/scipy/numpy) isn't installed locally, so the model execution + backtest run for real only
  when 2b wires it on a deploy. Not claiming more than that.
- **`statsforecast` is heavy** for a Vercel function (numba JIT + scipy → real cold-start + bundle
  weight). Spec'd choice; flagged for a look once deployed + timed (2b).

## Next (2b / 2c)

- **2b durable batch:** `forecastTenantBatchWorkflow` → `forecastShardWorkflow` (200-SKU shards,
  concurrency cap, backpressure), calls this function per SKU, writes `forecasts` / `forecast_points`
  / `forecast_evaluations` / `inventory_policy` idempotently; promotes only models that beat baseline;
  nightly cron + `recomputeForecast` action; `category_benchmarks` for cold SKUs.
- **2c chart:** `/forecasts/[productId]` — history + forecast + confidence bands + cobalt today-diamond
  + "Beats seasonal-naive by X% RMSSE" caption.
