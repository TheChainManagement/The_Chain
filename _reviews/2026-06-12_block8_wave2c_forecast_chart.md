# Codex Review — block8_wave2c_forecast_chart
**Date:** 2026-06-12 12:16
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block8_wave2c_forecast_chart
**Review weight:** full
**Skills audited:** moretech-codex-review
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The core chart surface was actually built. [`ForecastChart.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/ForecastChart/ForecastChart.tsx:34) renders history markers, forecast means, 80/95 bands, and the single today diamond; [`ForecastChart.test.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/ForecastChart/ForecastChart.test.tsx:18) covers the basic structure.
- The per-SKU route exists and is wired to a real read model. [`/forecasts/[productId]/page.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/[productId]/page.tsx:23) loads detail data, renders the chart, caption, stats, and recompute control; [`detail.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/detail.ts:64) loads forecast, points, evaluation, and history.
- The cockpit ledger and SKU lifetime chain changes are real, not fictional. [`/forecasts/page.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:99) links rows into the detail view, and [`inventory/[productId]/page.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/[productId]/page.tsx:84) now lights the `FORECASTED` stage from `latestForecast`.
- There is a memorable-element test artifact on disk, but it is RTL-only, not the required browser artifact. See [`_reviews/2026-06-12_feature_forecast_chart_memorable.test.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-12_feature_forecast_chart_memorable.test.tsx:1).

## What wasn't done

- The required visible artifact for this feature was not delivered in the form the contract asks for. `FEATURES.md` explicitly says the forecast-chart memorable element requires a Playwright capture, not a jsdom unit test: [`FEATURES.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:365). The only artifact on disk is [`_reviews/2026-06-12_feature_forecast_chart_memorable.test.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-12_feature_forecast_chart_memorable.test.tsx:1), which never drives a browser and never proves the rendered page.
- Skill compliance is still broken. The prompt says `moretech-codex-review` was invoked, but the compliance block says that skill is not in the registry, and the repo still carries the standing ticket to add it: [`_reviews/_tickets.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/_tickets.md:237).
- The contract’s `recomputeForecast(productId, locationId)` delivery is still incomplete. `FEATURES.md` and `SYSTEM_DESIGN.md` both name per-location recompute as part of the forecast feature surface, but the action flatly refuses `locationId`: [`FEATURES.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:345), [`SYSTEM_DESIGN.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/SYSTEM_DESIGN.md:439), [`actions.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/actions.ts:109). The test suite even locks that refusal in as expected behavior: [`tests/forecast/actions.test.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/forecast/actions.test.ts:142).

## What can be done better

- The new read-model surfaces are under-tested. There is coverage for `liftCaption` and chart structure, but nothing for `loadForecastDetail`, `listForecastedSkus`, or the inventory lifetime-chain behavior. The search trail only finds [`tests/forecast/detail.test.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/forecast/detail.test.ts:1) for helper logic and no route/read-model assertions.
- The cockpit ledger uses raw internal state strings (`cold`, `warming`, `warm`) instead of the operator-facing eligibility copy already available elsewhere. See [`page.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:108) versus the proper labels on the detail route at [`page.tsx`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/[productId]/page.tsx:47). It works, but it’s a weaker surface than the rest of the feature.
- The inventory-side forecast ignition got no dedicated test coverage at all. [`getProductDetail`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/inventory/queries.ts:103) and [`LifetimeChain`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/[productId]/page.tsx:84) changed behavior, but there is no corresponding assertion trail.

## What was missed

- The evidence says the detail page shows “the SAME weekly demand series the batch trains on,” but the code does not. The batch engine pages through all sale movements via `pageAll()` in [`batch-core.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/batch-core.ts:586), while the detail read model hard-caps sales rows at 2,000 in [`detail.ts`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/forecast/detail.ts:94). High-volume SKUs can render a chart from truncated history that is not the model’s real training series. That breaks the trust claim.
- The “tokens only” claim is false. The new chart CSS literally says “tokens only” at [`ForecastChart.module.css`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/ForecastChart/ForecastChart.module.css:1), but it hardcodes `1`, `3`, `1.2`, `9px`, `2 4`, etc. at lines 13, 14, 23, 31, 40, 44, 50, 55, 62, 70. The detail CSS does the same with `11px`, `10px`, `13px`, `14px`, `2px`, and `1px` at [`forecast-detail.module.css`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/[productId]/forecast-detail.module.css:9). That directly violates [`MASTER_PROMPT.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:17) and its production-ready rule at line 141.
- Error-state coverage is missing for the async route work you touched. The route directory for [`/forecasts/[productId]`](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/[productId]/page.tsx:23) has `loading.tsx` but no segment `error.tsx` artifact on disk, while [`MASTER_PROMPT.md`](/Users/themoreapp/More%20Technologies/projects/the-chain/MASTER_PROMPT.md:136) says empty, loading, and error states must exist for every async surface.

## Decisions (captured 2026-06-12, dispositioned by Claude per the standing wave cadence — MG to confirm at the session checkpoint)

### Truncated history breaks the trust claim (detail capped sales at 2,000 rows; batch pages all)
- **Decision:** fix now — REAL bug, exactly the kind the trust hierarchy exists to prevent.
- **Action:** `loadAllSales` pages through ALL trailing-year sale movements (same convention as the batch's `pageAll`). Integration test asserts the warm SKU's full ~47-week series renders untruncated. Re-verified live.

### "Tokens only" claim is false (px stroke widths / font sizes)
- **Decision:** fix the CLAIM, push back on the px churn per standing dispositions.
- **Action:** CSS headers corrected to "color/spacing via tokens; px per house style." The px values themselves match every shipped module.css; raw-px→tokens is the standing stack-audit ticket, and font-px was pushed back with evidence at 6.3 (no token exists). SVG stroke geometry is not a design token.

### Playwright capture required by FEATURES, RTL artifact delivered
- **Decision:** push back — standing infra-blocked disposition (recorded since Block 5).
- **Action:** the accepted standard remains RTL artifact + live screenshot verification (screenshot reviewed in-session: chart on real data). Playwright harness stays on the STILL BLOCKED list.

### `recomputeForecast` refuses locationId
- **Decision:** push back — deliberate, ticketed.
- **Action:** the engine is tenant-level this tranche (FEATURES multi-location activation is a later wave). An honest refusal beats silently ignoring the parameter; the per-location ticket stands.

### Read-model surfaces under-tested (loadForecastDetail / listForecastedSkus / lifetime chain)
- **Decision:** fix now.
- **Action:** 3 integration tests added against the seeded tenant: full-history detail load (incl. the truncation regression), ledger rows + promoted-first + operator labels, and `latestForecast` presence/absence driving the chain link. Suite 420/420.

### Ledger shows raw state strings
- **Decision:** fix now (lightweight).
- **Action:** ledger state cell now carries the FEATURES operator copy as its tooltip (`title`), keeping the compact mono column.

### Skill compliance: "moretech-codex-review not in registry"
- **Decision:** fix now — root cause found in the PLUGIN, not the repo.
- **Action:** the registry HAD the skill but its heading read `## moretech-codex-review (this skill)` and the audit parser uses the full heading as the name. Heading fixed in the plugin's `skill_registry.md`; the boomerang dies with the next review run.

### No segment error.tsx on /forecasts/[productId]
- **Decision:** push back — consistent with the accepted 6.3 disposition.
- **Action:** the `(app)/error.tsx` group boundary covers this segment (same evidence as 6.3-C/D).
