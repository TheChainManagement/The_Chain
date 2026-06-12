# Evidence — block8_wave2b_durable_forecast_batch

**Date:** 2026-06-11 (round-1 fixes 2026-06-12)
**Project:** The Chain
**Phase:** 6 (Features) · Block 8 (Demand forecasting) · Tranche C wave 2b
**Unit:** Durable forecast batch — tenant fan-out, shard workflows, idempotent writes, cron + action

> **Scope honesty up front:** this is the batch TRANCHE of Block 8, not the
> feature-complete block. The forecast chart (the block's memorable centerpiece)
> is wave 2c; the `inventory_policy` write is Block 9 step 1; the 5k/50k SLO
> proof needs the seeded Preview harness. Codex round-1 made the same point and
> the framing is accepted, not contested.

---

## Goal

Wire the 2a brain (eligibility + routing + the Python `statsforecast` function) into a durable,
crash-safe batch that forecasts a whole tenant catalog: `forecastTenantBatchWorkflow` fans out
200-SKU `forecastShardWorkflow` children under the tenant concurrency cap, each shard walks
25-SKU chunk steps that call the Python function and write `forecasts` / `forecast_points` /
`forecast_evaluations` idempotently, promotes only models that beat the seasonal-naive baseline,
fills cold SKUs from fresh `category_benchmarks`, and reports progress to a live cockpit.

## What was built

1. **Migration `20260611120000_block8_forecast_batch.sql`** — four contract gaps the schema had
   left open: `tenants.forecast_concurrency_limit` (FEATURES names it; default 4),
   `sync_runs.connection_id` nullable (a forecast batch has no source connection),
   `forecast_method` + `'benchmark'` (cold fills must not masquerade as a model), and
   `forecast_points.lower_bound_80/upper_bound_80` (the 2c chart contract shows BOTH bands; the
   existing pair is the 95% band per `forecasts.confidence_level`). Plus `ix_forecasts_tenant_run`
   for coverage polls. Applied locally; hosted apply pending at push.

2. **Engine (`src/lib/forecast/`)** — `shard.ts` (pure: 200-SKU plan, `halveConcurrency`
   backpressure, `nextLaunches` window fill); `series.ts` (pure: distinct-sale-day counting,
   weekly series with leading-zero trim + one ramp-in week, forward benchmark dates, trimmed mean,
   mean daily demand); `api-client.ts` (typed Python-function contract; 429/5xx/network →
   `RetryableError` honoring retry-after, 4xx/ok:false → `FatalError`; injectable fetch);
   `batch-core.ts` (server-only: plan + `category_benchmarks` refresh from WARM SKUs only with
   stale-category cleanup, chunk runner with idempotent skip-done writes + benchmark fills +
   per-SKU dead-letters to `sync_failures` + eligibility-transition audit rows, finalize with
   honest totals + `onboarding_state.first_forecast_ready_at` stamp); `queries.ts` (RLS read
   model for the cockpit). Reads page past the PostgREST 1000-row cap (`pageAll`).

3. **Workflows (`src/workflows/forecast-batch.ts`)** — parent plans, **runs the Block 7
   classification step inside the batch** (FEATURES Block 7 step 1 — routing reads stored ADI/CV²,
   so the batch refreshes it first), launches children via `start()` INSIDE a step (FEATURES
   checklist), polls child status (`getRun().status`) on a durable 15s `sleep` loop with a 1-hour
   timeout guard, halves concurrency on a failed shard + timestamps it into `sync_runs.error_log`,
   collects child totals from persisted `returnValue`s, finalizes. Shard membership is derived
   from stable `order by id` position — never carried in run state (no megabyte workflow inputs).
   Chunk results carry `slice` vs `processed` so a resumed shard never breaks early past
   unfinished chunks. Parent is the single writer of the sync_runs row; children only insert.

4. **Action + cron + UI** — `runForecastBatch` (owner/manager gate, pre-created sync_run whose id
   doubles as `forecasts.run_id`, failed-start cleanup) + `getForecastBatchProgress` poller;
   `/api/cron/forecast` (Bearer CRON_SECRET, one workflow per tenant with an active catalog) on
   `vercel.json` cron `15 7 * * *`; `/forecasts` BenchStub replaced by the real cockpit (metric
   strip FORECASTS/PROMOTED/MODELED/BENCHMARK-FILLED/FAILED, the eligibility ladder panel with
   FEATURES operator copy, batch controls). **Memorable element: the SHARD FLEET** — the batch
   renders as a row of shard tiles filling left-to-right as coverage lands (deep slate on hairline
   tracks; cobalt stays on the Run CTA). Artifact:
   `_reviews/2026-06-11_feature_forecast_fleet_memorable.test.tsx` (RTL, runs in CI).

5. **Python function hardening + local runtime** — `FORECAST_API_SECRET` shared-secret gate
   (constant-time compare; refuses when set and header missing — it is an open compute endpoint
   otherwise) and `scripts/forecast_dev_server.py`, which serves the UNCHANGED deployed handler
   locally (`.venv-forecast`, Python 3.13 — 3.14 is too new for numba). `forecastEnv()` resolves
   FORECAST_API_URL → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL.

## Verification

- **The 2a "Python runtime not verified" flag is CLOSED.** statsforecast 2.0.3 ran for real
  locally: AutoETS yhat≈18.15 with sane 95% bands on a 40-week series, Croston-SBA fit, rolling
  cross-validation RMSSE computed for model + baseline, `beats_baseline` honest (SBA lost, 0.850
  vs 0.833), 400 on <2 observations, 401 without the secret + through-the-gate with it.
- **Live end-to-end on the seeded `Riverbend Hardware` tenant** (block8-demo@thechain.test, 6
  SKUs / 615 movements with layered history): Run forecast batch → fleet rendered → completed in
  one poll cycle. Dev-server log shows the full durable sequence (plan 6/1-shard → classified=6 →
  launched shard 0 → chunk slice=6 processed=6 → poll states 0:completed → totals promoted=2 →
  finalize). The Python runner logged exactly 4 POSTs (the modeled SKUs; cold SKUs never call it).
- **DB facts:** RVB-1107/RVB-2214 `auto_ets · warm · promoted` (beat baseline 0.600/0.627 RMSSE);
  RVB-3321 `sba · warming · NOT promoted despite beats=true` (eligibility guard); RVB-4408
  `sba · warming · beats=false` (real statsforecast verdict); RVB-5512 `benchmark · cold` with 8
  flat points from the drip-irrigation benchmark (2.335/day × 7) and NULL bounds; RVB-6619
  `benchmark · cold · 0 points` (no category). `category_benchmarks` = pvc fittings 4.78 /
  drip irrigation 2.335, sample_size 1 each (warm SKUs only). sync_run `completed`,
  processed 6/6, totals `{modeled 4, benchmarked 2, promoted 2, failed 0}`. Console clean.
- **Suite 392/392** (49 new: shard 8, series 12, api-client 7, batch-core integration 6 incl.
  idempotent-rerun convergence + transition audit + dead-letter, actions 10, fleet memorable 5,
  +1 routing). `tsc` clean, `biome check src` clean, `next build` clean, py ast clean.

## Honest scope notes

- **`inventory_policy` is NOT written by this wave.** FEATURES Block 8 step 4 lists it in the
  shard transaction, but Block 9 step 1 ("add policy derivation step at the end of each forecast
  shard") owns the math (z·σ·√L needs lead times + scorecards). Writing placeholder policy rows
  would be fake numbers. The shard has the seam for Block 9 to extend.
- **The forecast chart is wave 2c** — this cockpit is the batch's dashboard, not the block's
  centerpiece. The shard fleet is this wave's craft element.
- **Writes are idempotent-converging, not single-transaction.** forecasts insert → points →
  evaluations; a crash between them re-runs the chunk, which skips SKUs whose forecasts row
  landed. Worst case: a forecast briefly missing points/eval until the retry converges — same
  class as the import writers.
- **`onboarding_state.first_forecast_ready_at`** stamps only when the row exists (created by the
  Block 1 onboarding flow); the RPC-bootstrapped demo tenant has none, so the stamp was a no-op
  there. Covered by the integration test with the row present.
- **Eligibility transitions audit only prior→different transitions**; a SKU's first-ever forecast
  is its initial state, not a transition. transitions=0 on the demo first run is correct.
- **season_length stays 1** until 104+ weeks of history exist (demand window is 52 weeks).
- **5k p95 < 15min SLO + 50k stress are Preview-harness items** (standing infra ticket); the
  in-chunk API pool is 4 with 25-SKU chunk steps — knobs are in one place when the bench runs.
- **Pre-existing lint regressions fixed in passing** (biome 2.4.x flagged Block 7 files shipped
  clean on an older biome): ARIA-table suppressions with rationale on `QuadrantGrid` (CSS grid
  can't be a real `<table>`), `role="img"` on `ClassificationBadge`'s aria-label span.

## Codex round-1 fixes (2026-06-12, review `_reviews/2026-06-11_block8_wave2b_forecast_batch.md`)

- **Crash convergence was REAL and fixed at the root.** Codex caught that a crash
  between the forecasts insert and its points/evaluation inserts would orphan the
  SKU forever (the skip-done check would skip it). Fix: `insert_forecast_bundles`
  RPC (`20260611130000`) — each chunk's forecast+points+evaluation bundles land in
  ONE transaction (also the FEATURES step-4 "single transaction" contract, minus
  the Block 9 policy write), idempotent on the per-run unique index. Integration
  tests prove atomicity (poisoned bundle → zero rows) and replay (no duplicates).
- **Backpressure now fires on the COMMON failure mode.** Retryable forecaster
  failures (429/5xx/network) are per-SKU dead-letters, so the shard completes and
  the old shard-failed trigger never saw them. The parent's poll step now counts
  `forecast_api_retryable` dead-letters and halves concurrency in any cycle they
  grow, timestamped to `sync_runs.error_log` (FEATURES: halve on RetryableError).
  Shard-failure halving stays.
- **`recomputeForecast({productId, locationId?})` action added** (FEATURES build
  step 6): one synchronous targeted chunk, fresh run id, tracked as a
  `forecast_single` sync_run; refuses a locationId honestly until multi-location
  activates; RLS existence check before any work. 5 action-path tests. The 2c
  chart gets the button.
- **Terminal-failure marking:** a batch whose step exhausts retries now marks its
  sync_run `failed` (was: stuck on `running`, poller spinning to its cap).
- **Segment `loading.tsx` added** (first in the app — mirrors the metric strip
  with StatNumber shimmers).
- **🐛 LIVE-CAUGHT BLOCK 7 BUG, fixed at the root:** the second live batch run
  failed in the classify step — `classifyTenant`'s insert-new-then-delete-old
  recompute violates `product_classifications_uniq_tenant_wide` (partial unique,
  in place since Foundation). Every classification recompute after a tenant's
  first has been broken since Block 7 shipped; it never surfaced because nothing
  re-ran classification against a populated snapshot in one verify. PostgREST
  upserts can't target a partial unique index, so the fix is the atomic
  `replace_classification_snapshot` RPC (`20260612090000`) + a back-to-back
  recompute regression test in the integration suite.
- **Pushed back (consistent with prior dispositions):** steps-in-file layout (all
  five shipped workflows keep steps inline; one-shot `src/workflows/steps/`
  alignment ticketed for the stack audit), workflow-loop orchestration tests
  (same class as the cron routes), the "memorable element must be the chart"
  reading (2c owns the chart; the fleet is this tranche's element).
- **Re-verified live after fixes:** a third batch run on the demo tenant through
  the RPC write path + recomputed classification: completed, 6 forecasts ·
  2 promoted, bundles complete (6/40/4 — identical shape to run 1), one clean
  6-row classification snapshot after three recomputes, console clean. Suite
  **400/400**, tsc/biome/build clean.

## Deploy saga (2026-06-12) — production was BROKEN since Wave 2a, now fixed

- **🐛 Every production deploy since `daeb3ae` (Wave 2a) had FAILED** — discovered at this wave's
  push. The Python function's dependency bundle hit **587 MB**, over the 500 MB Lambda
  ephemeral cap: statsforecast hard-imports `fugue` (its distributed layer, unused by our
  single-series calls), and fugue drags `triad` → `pyarrow` (~128 MB). Prod had silently frozen
  at Block 7; the "2a flagged the bundle weight" worry was real.
- **Fix (commit `1837b5a`):** `pyproject.toml` + `uv.lock` replace requirements.txt with uv
  `override-dependencies` excluding fugue/triad/adagio/pyarrow (resolved set: 26 packages,
  ~430 MB); `api/forecast/_shims/` satisfies statsforecast's fugue/triad import surface and
  raises LOUDLY on any genuinely distributed call (see `_shims/README.md`). All four routed
  models re-verified locally THROUGH the shims. **Deploy READY — production unblocked.**
- **Deployment Protection discovery:** the project runs Vercel Authentication on all
  *.vercel.app URLs (`ssoProtection: all_except_custom_domains`, no custom domain). That means
  the batch's own call to `/api/forecast` is intercepted at the edge in production. Wired:
  the API client sends `x-vercel-protection-bypass` from `VERCEL_AUTOMATION_BYPASS_SECRET`
  when present (Vercel injects it once Protection Bypass for Automation is enabled). The
  bypass cannot be created via REST — it is a dashboard toggle (MG step below).
- `FORECAST_API_SECRET` set in Vercel (Production + Preview, one var) — the function's own
  gate. Verified live that unauthenticated requests to the prod URL are refused (Vercel auth
  layer; the function gate sits behind it). Vercel CLI upgraded 54.6.1 → 54.12.2 in passing
  (the old CLI's non-interactive `env add preview` was broken).
- Hosted migrations applied via Supabase MCP: `block8_forecast_batch`,
  `block8_forecast_bundle_rpc`, `block7_classification_snapshot_rpc` — security advisors show
  only the same 4 pre-existing accepted WARNs; the two SECURITY-INVOKER RPCs added zero.

## Pending infra (MG/manual)

- **Enable "Protection Bypass for Automation"** (Vercel dashboard → the-chain → Settings →
  Deployment Protection). One click; Vercel then injects `VERCEL_AUTOMATION_BYPASS_SECRET`
  on the next deploy and the prod forecast batch can reach its own function. Until then the
  prod batch's modeled SKUs will dead-letter as retryable failures (cold benchmark fills and
  everything else still work).
- The same applies to the **Intuit webhook registration** (standing pending item): the
  registered URL needs `?x-vercel-protection-bypass=<secret>` appended (the documented
  query-param pattern for third-party webhooks) while deployment protection is on.
- First real prod batch: watch the Python function cold start (statsforecast import + numba).
- Standing QBO prod env vars + webhook registration (unchanged from 6.3).
