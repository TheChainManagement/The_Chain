# Evidence — block8_wave2c_forecast_chart

**Date:** 2026-06-12
**Project:** The Chain
**Phase:** 6 (Features) · Block 8 (Demand forecasting) · Tranche C wave 2c
**Unit:** The forecast chart — `/forecasts/[productId]`, the FEATURES-named memorable centerpiece

---

## Goal

The visible payoff the 2a brain and 2b batch were built for: a per-SKU view where an operator
SEES the math — the weekly demand the model trained on, the forward points with widening
confidence bands, and an honest verdict against seasonal-naive. Plus the surfaces that lead
into it (cockpit ledger, SKU-detail chain link) and the on-demand recompute button.

## What was built

1. **`ForecastChart` (`src/components/ForecastChart/`)** — hand-rolled SVG (color/spacing
   via tokens; px stroke geometry per house style), pure presentational. History = 1px deep-slate line with square weekly markers; forecast =
   hollow mean dots with per-week vertical pewter ranges (1px hairline 95%, heavier inner
   tick 80% — never filled, never cobalt, the FEATURES trust rule); ONE cobalt today-diamond
   on the boundary over a faint signal-line rule; mono region eyebrows
   (HISTORY · WEEKLY DEMAND / FORECAST · N WK), sparse mono ticks, dashed gridlines.
   Benchmark fills draw means with NO bands (no fake confidence). Co-located structural test.

2. **`/forecasts/[productId]`** — server page over the new RLS read model
   (`src/lib/forecast/detail.ts`: latest forecast + points + evaluation + the SAME weekly
   demand series the batch trains on, via `toWeeklySeries`). Meta strip: method label
   (`sba` → Croston-SBA), FEATURES eligibility copy, PROMOTED tag (flow tone). Under the
   chart: the **lift caption** (`liftCaption`, honest in all directions — "Beats
   seasonal-naive by X% RMSSE" / "Trails … — not promoted" / "Category benchmark fill — no
   model to judge yet" / backtest-unavailable / degenerate-baseline) + StatNumber stats
   (RMSSE, baseline RMSSE, WAPE %, windows, computed-at). `RecomputeControls` island wires
   the 2b `recomputeForecast` action. Segment `loading.tsx`. No MAPE anywhere (PRD ban).

3. **Cockpit ledger** — `/forecasts` "land next" note replaced by the forecasted-SKU ledger
   (latest run): sku · name · method · state · RMSSE · PROMOTED, each row linking to the
   chart. Promoted rows sort first.

4. **Lifetime chain ignition** — `ProductDetail` gains `latestForecast`; the SKU detail's
   FORECASTED link now lights ("Model promoted" / "Forecast live" + timestamp) and earlier
   links settle to done. A SKU with sales but no receipts truthfully shows STOCKED pending
   while FORECASTED is live (the chain reports facts, not a forced sequence).

## Verification (live, Riverbend Hardware demo tenant)

- **Cockpit:** ledger renders 6 rows, promoted first; rows link through.
- **RVB-1107 (warm, AutoETS, promoted):** chart = 44 history markers, 8 means, 8×95% +
  8×80% bands, 1 cobalt diamond; caption **"Beats seasonal-naive by 3.2% RMSSE"**; stats
  0.600 / 0.620 / 6.6% / 2 windows. Screenshot reviewed — on-direction (flat panels, mono
  numerics, cobalt only on the diamond + Recompute CTA).
- **Recompute button:** clicked live → real Python call → "Forecast recomputed", computed-at
  jumped to the fresh run.
- **RVB-5512 (cold, benchmark):** 8 benchmark means, ZERO bands, caption "Category benchmark
  fill — no model to judge yet.", tags "Category benchmark" + "warming up — using category
  benchmark" (FEATURES acceptance: never show a model prediction).
- **Lifetime chain:** FORECASTED lit "Model promoted · Jun 12 · 12:11" (the recompute's own
  timestamp). Console clean throughout.
- **Memorable artifact:** `_reviews/2026-06-12_feature_forecast_chart_memorable.test.tsx`
  (RTL, runs in CI) — asserts the single cobalt diamond, the 95% rings WIDENING across the
  horizon with the 80% ring nested inside at every week, the weekly history markers, and the
  exact "Beats seasonal-naive by 14.3% RMSSE" caption from the FEATURES copy.
- **Suite 420/420** (19 new: detail/lift 7, chart structure 5, memorable 4, read-model
  integration 3 post-Codex). `tsc`, biome, `next build` clean (`/forecasts/[productId]` in the
  route table, PPR). Chart also added to the `/gallery` showcase with a fixture.

## Codex round-1 (2026-06-12, review `_reviews/2026-06-12_block8_wave2c_forecast_chart.md`)

Fixed in-slice: **full-history paging in the detail read model** (real bug — a high-volume
SKU could chart truncated history while the batch trained on all of it; now pages like the
batch and is regression-tested), read-model integration tests (detail load, ledger,
lifetime-chain ignition), ledger state tooltips with the FEATURES operator copy, CSS header
claims corrected ("tokens only" was an overclaim — px is house style per standing
disposition), and the PLUGIN skill-registry heading that made every review's compliance
audit miss `moretech-codex-review` (parser uses the full H2 text; the parenthetical broke
the match). Pushed back per standing dispositions: Playwright capture (infra-blocked; RTL +
live screenshot is the accepted standard), per-location recompute (later wave, honest
refusal), segment error.tsx (group boundary covers it, 6.3 precedent). Decisions appended
to the review file.

## Honest scope notes

- The 2c chart completes Block 8's USER-FACING contract; still open on the block:
  the 5k/50k performance proof (standing Preview-harness ticket) and `inventory_policy`
  (Block 9 step 1 extends the shard). Multi-location stays schema-only (engine is
  tenant-level; `recomputeForecast` refuses a locationId honestly).
- The chart is weekly-grained because the engine is (DEMAND_WEEKS bucketing); daily grain
  would be a modeling change, not a chart change.
- x-axis spacing is uniform per week index (the series IS weekly); date ticks label
  month-day.
