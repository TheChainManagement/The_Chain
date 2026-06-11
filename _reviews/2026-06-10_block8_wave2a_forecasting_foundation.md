# Codex Review — block8_wave2a_forecasting_foundation
**Date:** 2026-06-10 21:10
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block8_wave2a_forecasting_foundation
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- A real TypeScript routing layer exists in [src/lib/forecast/routing.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:1). It defines the cold/warming/warm ladder, `eligibilityThresholdMet`, and ADI/CV²-based method selection at [lines 44-90](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:44).
- A real Python forecast entrypoint exists at [api/forecast/index.py](/Users/themoreapp/More%20Technologies/projects/the-chain/api/forecast/index.py:1). It is stateless on disk, does no DB writes, runs a routed model plus `SeasonalNaive`, and returns forecast points plus RMSSE/WAPE evaluation at [lines 78-146](/Users/themoreapp/More%20Technologies/projects/the-chain/api/forecast/index.py:78).
- Python dependencies were actually added in [requirements.txt](/Users/themoreapp/More%20Technologies/projects/the-chain/requirements.txt:1), and the schema already has the forecast tables and `category_benchmarks` table in [supabase/migrations/20260530120400_init_forecasting.sql](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120400_init_forecasting.sql:6).
- There is at least narrow test coverage for the TS slice in [tests/forecast/routing.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/forecast/routing.test.ts:1). The routing test file passes locally, and the Python file compiles with `py_compile`.
- The evidence file is honest about scope. [_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md:41) explicitly says this is only the engine slice and defers the durable batch and chart.

## What wasn't done

- The feature contract says build `forecastTenantBatchWorkflow` and `forecastShardWorkflow` ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:342)), but there is no forecast workflow in `src/workflows`; the only workflow files are [import.ts, qbo-incremental.ts, qbo-sync.ts, smoke.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/workflows).
- The contract says wire nightly cron and on-demand recompute ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:345)), but [vercel.json](/Users/themoreapp/More%20Technologies/projects/the-chain/vercel.json:3) only declares the QBO cron, and there is no `recomputeForecast` action anywhere in the tree.
- The contract says build `/app/forecasts/[productId]` with the chart ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:346)), but the only forecast route on disk is the stub [src/app/(app)/forecasts/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:1), and it renders `BenchStub` text instead of a feature.
- The required memorable artifact does not exist. `MASTER_PROMPT.md` requires `_reviews/<date>_feature_<name>_memorable.{png,test.ts}` ([MASTER_PROMPT.md](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:135)); the only Block 8 review artifact on disk is the evidence note [_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md:1).
- The forecast batch acceptance harness is missing. There is no `bench:forecast` script in [package.json](/Users/themoreapp/More%20Technologies/projects/the-chain/package.json:9), no preview-env benchmark artifact, and no sharding/backpressure evidence.
- The evidence file admits the missing deliverables outright: durable batch and chart are listed under “Next,” not “built,” at [lines 51-58](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md:51). This is not the Block 8 feature contract; it is a partial foundation slice.
- Skill compliance is malformed. The prompt says the invoked skill was `none`, but the compliance block also says `none` is not in the registry. That means the claimed skill trail is not auditable before code review even starts.

## What can be done better

- The router is underspecified relative to its own types. [src/lib/forecast/routing.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:22) exposes `tsb` and `seasonal_naive`, but [routeForecast](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:76) never returns either. That is not a finished routing policy; it is a half-wired enum.
- The Python endpoint silently launders bad input. [index.py:94](/Users/themoreapp/More%20Technologies/projects/the-chain/api/forecast/index.py:94) coerces non-numeric demand values to `0.0` instead of rejecting them. That will bury upstream data bugs inside “valid” forecasts.
- The backtest path swallows every runtime failure and still returns `ok: true`. [index.py:119-126](/Users/themoreapp/More%20Technologies/projects/the-chain/api/forecast/index.py:119) catches `Exception`, zeros `n_windows`, and ships the forecast anyway. That destroys reviewability when the statistical evaluation breaks.
- The forecast surface is still generic product scaffolding, not visible craft. [src/app/(app)/forecasts/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:5) is a placeholder paragraph. That is exactly the kind of convergence slop the project rules are supposed to block.
- The evidence file claims “deploy-verified” Python while also stating there is no local test harness and the package stack is not installed locally at [lines 45-47](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_block8-wave2a-forecasting-foundation.md:45). That wording is too generous for what exists on disk. What exists is syntax-checked code plus TS unit tests.

## What was missed

- The cold-start ladder is implemented as elapsed time since the first sale at [src/lib/forecast/routing.ts:44-49](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:44). That means one sale 90 days ago makes a SKU “warm.” The contract says eligibility is based on actual sale-history depth for the SKU, not a single ancient event.
- The required operator labels are not delivered. `FEATURES.md` requires “warming up — using category benchmark” and “early signal — confidence limited” ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:348)), but the code only returns “Category benchmark” / “Croston-SBA” / “AutoETS” / “AutoARIMA” in [routing.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/routing.ts:77).
- The category-benchmark contract is effectively untouched. The schema table exists at [init_forecasting.sql:74](/Users/themoreapp/More%20Technologies/projects/the-chain/supabase/migrations/20260530120400_init_forecasting.sql:74), but there is no refresh logic, no trimmed-mean computation, and no use of `products.attributes.category`.
- The SKU detail page still tells the user forecasting has not happened. The lifetime chain hardcodes `FORECASTED` as pending with the label “Awaiting forecast” at [src/app/(app)/inventory/[productId]/page.tsx:111-116](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/%5BproductId%5D/page.tsx:111). That directly contradicts the feature’s memorable-element requirement for a live forecast chart.
- The acceptance criterion around audit-logging eligibility transitions was missed completely. There is no forecast mutation path, no audit write, and no review artifact demonstrating cold → warming → warm transitions.

## Decisions / round-1 dispositions (2026-06-10)

Full-weight review of a deliberately partial FOUNDATION slice (the engine; durable batch + chart are
2b/2c). Codex itself notes "partial foundation slice." Real foundation issues fixed; the rest is
deferred-by-design scope, ticketed.

**Fixed now:**
- **Cold-start ladder used elapsed-since-first-sale** ("one sale 90d ago → warm"). Changed to history
  DEPTH: `eligibility(saleDays)` counts distinct sale-days; <30 cold / 30–89 warming / 90+ warm. The
  2b engine computes the distinct-sale-day count.
- **Missing operator labels** — added `eligibilityLabel` with the FEATURES copy ("warming up — using
  category benchmark" / "early signal — confidence limited").
- **Half-wired enum** — `routeForecast` now returns `tsb` for lumpy demand (intermittent + erratic
  sizes) vs `croston_sba` for smoother intermittent; `seasonal_naive` documented as the baseline
  vocabulary (always run by the Python function, never the routed primary).
- **Python silently coerced bad demand to 0** → `pd.to_numeric(errors="raise")` (a 0 is a real
  no-sales period; garbage is an upstream bug we must not bury).
- **Python backtest swallowed all errors with ok:true** → still ships the forecast (a short series
  genuinely can't cross-validate) but now SURFACES `evaluation.error` instead of hiding it.
- **"deploy-verified" wording** softened to "syntax-checked + TS-tested; runtime verified on deploy".

**Pushed back (deferred by design — wave 2b/2c):** `forecastTenantBatchWorkflow`/shard + backpressure,
nightly cron + `recomputeForecast`, the `/forecasts/[productId]` chart (the memorable element +
Playwright artifact land here), `category_benchmarks` refresh + trimmed mean, audit-logged
cold→warming→warm transitions, the 5k forecast bench harness, the SKU-detail "FORECASTED" chain link
(accurately pending until 2b writes forecasts). All ticketed.
