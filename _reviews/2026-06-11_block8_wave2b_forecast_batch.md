# Codex Review — block8_wave2b_forecast_batch
**Date:** 2026-06-11 22:32
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block8_wave2b_forecast_batch
**Review weight:** full
**Skills audited:** moretech-codex-review
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The durable tenant batch is real. [`src/workflows/forecast-batch.ts:77`](</Users/themoreapp/More Technologies/projects/the-chain/src/workflows/forecast-batch.ts:77>) through [`:347`](</Users/themoreapp/More Technologies/projects/the-chain/src/workflows/forecast-batch.ts:347>) contains `forecastTenantBatchWorkflow` and `forecastShardWorkflow`, launches child workflows from a `"use step"`, polls them, and finalizes the run.
- The batch write/read core is real. [`src/lib/forecast/batch-core.ts:117`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:117>) plans the run and refreshes `category_benchmarks`; [`:246`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:246>) runs chunks, routes cold vs modeled SKUs, writes `forecasts` / `forecast_points` / `forecast_evaluations`, and inserts `audit_log` / `sync_failures`; [`src/lib/forecast/queries.ts:78`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/queries.ts:78>) builds the cockpit read model.
- The supporting contract work exists on disk: migration [`supabase/migrations/20260611120000_block8_forecast_batch.sql:9`](</Users/themoreapp/More Technologies/projects/the-chain/supabase/migrations/20260611120000_block8_forecast_batch.sql:9>) adds `tenants.forecast_concurrency_limit`, relaxes `sync_runs.connection_id`, adds `forecast_method='benchmark'`, and adds 80% interval columns; cron route [`src/app/api/cron/forecast/route.ts:16`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/api/cron/forecast/route.ts:16>) is wired in [`vercel.json:8`](</Users/themoreapp/More Technologies/projects/the-chain/vercel.json:8>); the Python function is hardened with a shared secret at [`api/forecast/index.py:167`](</Users/themoreapp/More Technologies/projects/the-chain/api/forecast/index.py:167>).
- The `/forecasts` cockpit and the shard-fleet test artifact exist. See [`src/app/(app)/forecasts/page.tsx:19`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:19>), [`src/app/(app)/forecasts/ForecastBatchControls.tsx:24`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts/ForecastBatchControls.tsx:24>), and [`_reviews/2026-06-11_feature_forecast_fleet_memorable.test.tsx:26`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_feature_forecast_fleet_memorable.test.tsx:26>).

## What wasn't done

- The Block 8 step-4 write contract is not delivered. `FEATURES.md` requires each shard step to write `forecasts` + `forecast_points` + `forecast_evaluations` + `inventory_policy` in a single transaction ([`FEATURES.md:343`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:343>)). The code explicitly does not write `inventory_policy` ([`src/lib/forecast/batch-core.ts:18`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:18>)), and the evidence admits that omission at [`_reviews/2026-06-11_block8-wave2b-forecast-batch.md:90`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:90>).
- The on-demand recompute action is still missing. `FEATURES.md` requires `recomputeForecast(productId, locationId)` ([`FEATURES.md:345`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:345>)). There is no such action anywhere in `src`, and the only forecast actions on disk are [`src/app/(app)/forecasts/actions.ts`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts/actions.ts:1>).
- The required SKU forecast page is still not built. `FEATURES.md` requires `/app/forecasts/[productId]` with the chart and confidence bands ([`FEATURES.md:346`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:346>)). The `forecasts` segment contains only [`page.tsx`, `actions.ts`, `ForecastBatchControls.tsx`, `forecasts.module.css`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts), no `[productId]` route.
- The required memorable element is not the one the contract asked for. `FEATURES.md` says the memorable element is the SKU forecast chart with the cobalt today-diamond and RMSSE caption ([`FEATURES.md:367`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:367>)). The shipped artifact is instead a shard-fleet ribbon, and the evidence explicitly says “The forecast chart is wave 2c” at [`_reviews/2026-06-11_block8-wave2b-forecast-batch.md:94`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:94>).
- The performance acceptance harness is still absent. `FEATURES.md` requires the 5k/50k batch proof ([`FEATURES.md:356`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:356>)); `MASTER_PROMPT.md` requires the preview harness ([`MASTER_PROMPT.md:145`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:145>)). `package.json` has no `bench:forecast` script ([`package.json:9`](</Users/themoreapp/More Technologies/projects/the-chain/package.json:9>)), and the evidence punts the SLO to later at [`_reviews/2026-06-11_block8-wave2b-forecast-batch.md:106`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:106>).
- Skill compliance is incomplete. The prompt says `moretech-codex-review` was invoked, but the compliance block also says that skill is not in the registry, so there is no auditable skill artifact trail. That belongs in the fail bucket, not as a shrug.

## What can be done better

- The async surface is still underbaked. The `forecasts` segment does async server reads in [`src/app/(app)/forecasts/page.tsx:19`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:19>) but there is no segment-local `loading.tsx`, and only the broad app-level boundary exists at [`src/app/(app)/error.tsx:19`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/error.tsx:19>). That does not meet the project’s “empty / loading / error states for every async surface” bar in [`MASTER_PROMPT.md:136`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:136>).
- The visible craft is converging toward dashboard filler. [`src/app/(app)/forecasts/page.tsx:40`](</Users/themoreapp/More Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:40>) is a metrics strip plus ladder copy. It is functional, but it is not the forecast feature’s distinctive surface; the contract wanted something users trust because they can see the math, not another admin status panel.
- The feature folder structure drifts from the project rule. `MASTER_PROMPT.md` says step functions belong under `src/workflows/steps/` ([`MASTER_PROMPT.md:126`](</Users/themoreapp/More Technologies/projects/the-chain/MASTER_PROMPT.md:126>)). This feature keeps all step implementations inline inside [`src/workflows/forecast-batch.ts`](</Users/themoreapp/More Technologies/projects/the-chain/src/workflows/forecast-batch.ts:1>). That is not a functional break, but it is a direct deviation from the stated structure rule.

## What was missed

- The claimed crash convergence is false. [`src/lib/forecast/batch-core.ts:264`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:264>) loads existing forecasts for the run, and [`:279`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:279>) drops those SKUs from `pending` entirely. But points/evaluations are only written for rows inserted in the current pass at [`:431`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:431>). If the process crashes after inserting `forecasts` but before inserting `forecast_points` or `forecast_evaluations`, the rerun skips that SKU forever. That directly contradicts the evidence claim at [`_reviews/2026-06-11_block8-wave2b-forecast-batch.md:96`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:96>).
- Backpressure is wired to the wrong failure mode. `FEATURES.md` says halve concurrency on `RetryableError` ([`FEATURES.md:342`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:342>)). But `runForecastChunk` catches `RetryableError` from the API and downgrades it into a per-SKU dead-letter at [`src/lib/forecast/batch-core.ts:350`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:350>), while the parent only halves concurrency when a child workflow status becomes `failed` or `cancelled` at [`src/workflows/forecast-batch.ts:309`](</Users/themoreapp/More Technologies/projects/the-chain/src/workflows/forecast-batch.ts:309>). In the common retryable API-failure path, the shard still completes and backpressure never fires.
- The feature still misses the location-aware contract. The required on-demand surface is `recomputeForecast(productId, locationId)` ([`FEATURES.md:345`](</Users/themoreapp/More Technologies/projects/the-chain/FEATURES.md:345>)), and the forecasting schema is location-capable ([`supabase/migrations/20260530120400_init_forecasting.sql:10`](</Users/themoreapp/More Technologies/projects/the-chain/supabase/migrations/20260530120400_init_forecasting.sql:10>), [`:57`](</Users/themoreapp/More Technologies/projects/the-chain/supabase/migrations/20260530120400_init_forecasting.sql:57>)). The shipped batch hardcodes `location_id: null` on forecast writes at [`src/lib/forecast/batch-core.ts:421`](</Users/themoreapp/More Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:421>) and never exposes a location-specific recompute path.
- The review evidence oversells completion. The file title is “durable forecast batch,” but it also admits the feature’s centerpiece, the policy write, and the performance proof are all deferred at [`_reviews/2026-06-11_block8-wave2b-forecast-batch.md:90`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:90>), [`:94`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:94>), and [`:106`](</Users/themoreapp/More Technologies/projects/the-chain/_reviews/2026-06-11_block8-wave2b-forecast-batch.md:106>). That is a useful tranche, not a feature-complete Block 8 delivery.

## Decisions (captured 2026-06-12, dispositioned by Claude per the standing wave cadence — MG to confirm at the session checkpoint)

### Crash convergence false claim (forecasts row without points/eval orphaned on rerun)
- **Decision:** fix now — REAL bug.
- **Action:** `insert_forecast_bundles` RPC (migration `20260611130000`): whole-chunk bundles in one transaction, idempotent on the per-run unique index. Atomicity + replay integration tests added.

### Backpressure wired to the wrong failure mode (retryable API errors never halve concurrency)
- **Decision:** fix now — REAL contract miss.
- **Action:** parent poll step counts `forecast_api_retryable` dead-letters; concurrency halves in any poll cycle they grow, timestamped to `sync_runs.error_log`. Shard-failure halving retained.

### `recomputeForecast(productId, locationId)` missing
- **Decision:** fix now.
- **Action:** `recomputeForecast({productId, locationId?})` Server Action: owner/manager gate, RLS existence check, one targeted synchronous chunk, `forecast_single` sync_run, honest refusal of locationId until multi-location activates. 5 action tests. UI button lands with the 2c chart.

### `inventory_policy` not written in the shard transaction
- **Decision:** push back with contract cross-reference.
- **Action:** FEATURES Block 9 step 1 explicitly owns "add policy derivation step at the end of each forecast shard" — the math needs lead times + scorecards. The bundle RPC is the transaction seam Block 9 extends. Writing placeholder policy numbers would violate the no-fake-numbers rule.

### Memorable element is the chart, not the fleet / cockpit reads as dashboard filler
- **Decision:** accept the framing, defer the chart to 2c (already the locked plan).
- **Action:** evidence lede now states the tranche framing up front. The fleet stays as this wave's element; 2c ships the chart with the cobalt today-diamond + RMSSE caption.

### Missing loading.tsx on the forecasts segment
- **Decision:** fix now.
- **Action:** `src/app/(app)/forecasts/loading.tsx` — metric-strip skeleton with StatNumber shimmers (first segment-local loading state in the app; pattern available for other segments at the stack audit).

### 5k/50k performance proof absent
- **Decision:** ticket (standing).
- **Action:** remains on the seeded-Vercel-Preview harness ticket with the import 10k/50k bench. In-chunk API pool (4) + chunk size (25) are the tuning knobs.

### Steps not under `src/workflows/steps/`
- **Decision:** push back; ticket a one-shot alignment.
- **Action:** all five shipped workflow files keep steps inline — a per-wave deviation would be churn; aligned move ticketed for the stack audit.

### Skill-compliance "moretech-codex-review not in registry"
- **Decision:** ticket (plugin fix, not this repo).
- **Action:** add the review skill itself to `references/skill_registry.md` in the moretech plugin so the audit stops flagging its own gate.

### Live-caught during re-verification (not in the Codex list): classification recompute broken since Block 7
- **Decision:** fix now — production-real (the Recompute button errors on every second run).
- **Action:** `replace_classification_snapshot` RPC (migration `20260612090000`) + back-to-back recompute regression test. Root cause: insert-then-delete vs the Foundation partial unique index; PostgREST upsert cannot target partial indexes.

### Also hardened in the same pass
- Terminal step failure now marks the batch sync_run `failed` (was stuck `running`).
