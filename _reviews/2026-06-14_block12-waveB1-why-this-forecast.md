# Block 12 Wave B1 — "Why this forecast" — evidence

**Date:** 2026-06-14
**Scope:** Wire the second AI-insight surface (`forecast` kind) onto the per-SKU
forecast detail page, reusing the Wave A engine (lazy + cached, gateway +
fallback, data-driven confidence). First of three Wave B slices (B2 "what
changed", B3 what-if interpretation to follow).

## What shipped
- **`buildForecastPrompt` injection fix** — the forecast prompt interpolated
  `f.sku` **raw** (no `safeLabel`), the same hole Codex caught on the reorder
  prompt in Wave A but still open on this path. Now neutralized + regression-tested.
- **`getForecastInsight(admin, tenantId, productId)`** (`src/lib/insights/generate.ts`)
  — resolves the SKU's **latest** forecast and keys the cache on the **forecast
  id**, not the product id, so a recompute (new forecast row) busts the cache and
  the prose never describes a superseded model. Assembles typed facts only (mean
  demand/period, representative 80% band averaged across the widening horizon,
  RMSSE; benchmark fills carry `rmsse=null`). `forecastConfidence` is data-driven
  from fact completeness — a benchmark fill drops below 0.6 and trips the warning.
- **`loadForecastInsight(productId)`** action — RLS existence check on the product,
  then admin-client generation (mirrors `loadReorderInsight`).
- **`ForecastInsightPanel`** — 1:1 mirror of `ReorderInsightPanel`, topic
  "why this forecast", rendered below the chart on `/forecasts/[productId]`.

## Tests
- `tests/insights/prompts.test.ts`: forecast injection neutralization, missing-facts
  → "unknown", `forecastConfidence` data-driven (high backtested / <0.6 benchmark fill).
- `tests/insights/cache.test.ts`: `getForecastInsight` resolves the latest forecast
  and serves the cached insight with **no model call**; friendly error when the SKU
  has no forecast.
- **Suite 562/562**, `tsc --noEmit` clean, biome clean.

## Live verification (local, real AI Gateway key)
Seeded a loginable tenant with one promoted `auto_ets` forecast (mean 14/wk,
widening 80% band, RMSSE 0.82 vs baseline 0.95), signed in, loaded
`/forecasts/<sku>`:
- **First view (cache miss → live model):** panel generated a faithful operator
  memo — *"The forecast expects modest, steady demand … the prediction band is
  fairly wide relative to the mean … the model outperforms the seasonal-naive
  baseline … hold enough buffer stock to cover the upper end of plausible demand."*
  No invented numbers; correctly reads the beats-baseline + wide-band facts.
  Caption `anthropic/claude-sonnet-4.6 · prompt v1`, confidence **90%**.
- **Reload (cache hit):** caption `anthropic/claude-sonnet-4.6 · prompt v1 · cached`
  — idempotency proven live, no second model call.
- Chart + lift caption ("Beats seasonal-naive by 13.7% RMSSE") render above the
  panel; **0 console errors**.
- Screenshot captured inline in-session (the `preview_screenshot` path gotcha
  means it isn't written to disk — DOM assertions above are the evidence of record).
- Throwaway seed tenant + user deleted; seed script removed.

## Deferred to Wave B
- **B2 — "What changed since last week"** (new insight kind + facts builder).
- **B3 — what-if slider interpretation** on `/inventory/policy` (Claude reads the
  scrubbed trade-off alongside the recomputed `<StatNumber>`s).
- Right-rail (vs inline) placement is still ticketed.

## Gate remaining before push
`moretech-codex-review` (per the per-feature checkpoint cadence: build → screenshot
→ MG → Codex → push).
