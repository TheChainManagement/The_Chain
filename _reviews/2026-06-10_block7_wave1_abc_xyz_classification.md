# Codex Review — block7_wave1_abc_xyz_classification
**Date:** 2026-06-10 20:49
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block7_wave1_abc_xyz_classification
**Review weight:** full
**Skills audited:** none
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The Block 7 surface is real code, not just prose. There is a classification route at [src/app/(app)/inventory/classification/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/page.tsx:19), a presentational quadrant at [src/app/(app)/inventory/classification/QuadrantGrid.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/QuadrantGrid.tsx:20), a server action at [src/app/(app)/inventory/classification/actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/actions.ts:21), and a classification engine at [src/lib/classification/classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:126).
- The math layer exists and is unit-tested. `bucketWeeklyDemand`, `computeXyz`, `bucketXyz`, and `assignAbc` are implemented in [src/lib/classification/compute.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/compute.ts:48) and covered in [tests/classification/compute.test.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/tests/classification/compute.test.ts:11).
- The quadrant read model is real. [src/lib/classification/queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/queries.ts:50) reads `product_classifications`, groups rows into the 3×3 grid, and preserves no-XYZ rows as `awaitingSignal`.
- A dedicated `ClassificationBadge` component was built at [src/components/ClassificationBadge/ClassificationBadge.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/ClassificationBadge/ClassificationBadge.tsx:19), and the inventory page now links into the classification cockpit via [src/app/(app)/inventory/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/page.tsx:39).
- There is an on-disk memorable-artifact test file at [_reviews/2026-06-10_feature_classification_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_feature_classification_memorable.test.tsx:44), and the gallery now includes Block 7 fixture rendering in [src/app/gallery/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/gallery/page.tsx:354).

## What wasn't done

- The feature contract says classification is implemented inside `forecastTenantBatchWorkflow` ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:308)), but there is no such workflow code in the tree. The only trigger is a manual synchronous action in [actions.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/actions.ts:21). This is not the shipped contract.
- The contract says rows are upserted per `(tenant, product, location)` ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:309)). The implementation hardcodes `location_id: null` for every row and explicitly says “tenant-wide ... for now” in [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:6) and [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:188).
- The contract says threshold-version inserts trigger a reclassification run and prior classifications are retained in `audit_log` for replay ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:316)). I found no trigger, no workflow, no action, and no test for that. `classifyTenant` just deletes the tenant snapshot and reinserts rows at [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:199).
- The contract says the quadrant supports drag-zoom, filters the SKU list below, and captures zoom in URL search params ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:312), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:318), [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:326)). The shipped page has no `searchParams`, no zoom state, no filtered list below the grid, and no interaction code at [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/page.tsx:19) and [QuadrantGrid.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/QuadrantGrid.tsx:20).
- The contract says classification should surface on inventory list, product detail, and forecast view, with method routing in forecasts ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:311)). The forecast page is still a stub at [src/app/(app)/forecasts/page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/forecasts/page.tsx:5), and there is no routing behavior tied to classification anywhere in `src/app/(app)/forecasts`.
- The p95 `< 1.5s` benchmark for 5,000 SKUs is not delivered. I found no `bench:classification` harness, no preview-env report, and no artifact proving the acceptance criterion at [FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:317).
- The required memorable artifact is off-contract. The feature specifically asks for a Playwright capture of full view and zoomed A/X ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:326)). What exists is a jsdom/Vitest render test over fixture data at [_reviews/2026-06-10_feature_classification_memorable.test.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/_reviews/2026-06-10_feature_classification_memorable.test.tsx:1). No Playwright interaction, no zoom capture.
- Skill compliance is not actually auditable from the declared input. The prompt says skills were `none`, but the compliance block also says `none` is not in the registry. That means the skill declaration is malformed, so the compliance trail is incomplete before the review even starts.

## What can be done better

- Stop claiming “Tokens only” while hardcoding pixel values all over the new files. [src/app/(app)/inventory/classification/classification.module.css](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/classification.module.css:6) hardcodes `14px`, and the same file keeps going with `10px`, `13px`, `84px`, `15px`, `116px`, `2px`, `3px`, `6px`, `180px`, `720px` through [line 191](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/classification.module.css:191). `ClassificationBadge.module.css` hardcodes `3px`, `10px`, and `12px` at [lines 6-17](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/ClassificationBadge/ClassificationBadge.module.css:6). The new bench header link does the same at [src/components/bench/page.module.css:10-16](/Users/themoreapp/More%20Technologies/projects/the-chain/src/components/bench/page.module.css:10). This is direct MASTER_PROMPT drift.
- The repo now has a canonical `ClassificationBadge`, but the actual inventory surfaces ignore it. The list reimplements a private `ClassTag` in [InventoryLedger.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/InventoryLedger.tsx:142), and the detail view renders raw `ABC` / `XYZ` characters in [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/[productId]/page.tsx:223). That is needless duplication and guarantees UI drift.
- The visible-craft direction is wrong. The feature spec’s memorable element is an A/X “where the money is” focus with cobalt outline and drag-zoom ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:326)). The shipped implementation instead highlights A/B·Z with a `WATCH` state at [QuadrantGrid.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/classification/QuadrantGrid.tsx:84). That is a different interaction and a different story.
- The read path is naïve for the stated scale target. [loadQuadrant()](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/queries.ts:50) pulls all classification rows and all active products separately, then groups and sorts in memory. For a feature with an explicit 5k benchmark, this wants a purpose-built query shape and an actual bench, not “it should probably be fine.”
- The test coverage is too shallow for a feature claiming system-only mutation and catalog-wide recomputation. I found math tests and a fixture render test, but no action-layer tests for role gating, no integration tests proving service-role-only writes, no tests around snapshot replacement failure modes, and no tests for `loadQuadrant()` over real Supabase rows.

## What was missed

- Cold-start handling is not what the review checklist asked for. The checklist says cold SKUs should be flagged as unclassified with `cold_start_state='cold'` ([FEATURES.md](/Users/themoreapp/More%20Technologies/projects/the-chain/FEATURES.md:321)). The implementation has no `cold_start_state` anywhere. It just sets `xyzClass: null` in [compute.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/compute.ts:65) and dumps those rows into `awaitingSignal` in [queries.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/queries.ts:90). That is only half the requirement.
- The `revenue_basis` contract is effectively faked. The thresholds object carries `'cost' | 'price'`, but the computation always uses supplier cost and never branches on basis in [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:172). If a threshold version says `price`, this code still computes cost-basis classification and lies about it by persisting `revenue_basis` at [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:194).
- The classification segment has no local `loading.tsx` or `error.tsx` at all. `find` came back empty under `src/app/(app)/inventory/classification/`. For a page doing async server reads, that misses the project rule that async surfaces ship with loading and error states.
- The delete-then-insert snapshot write can leave the tenant with zero classifications if the insert fails after the delete. [classify.ts](/Users/themoreapp/More%20Technologies/projects/the-chain/src/lib/classification/classify.ts:201) deletes first, then inserts. There is no explicit transaction here, and no evidence that this path is crash-safe. For a catalog-wide classification feature, that is a bad failure mode.
- The inventory list and detail pages still do not satisfy the “badge row” part of the feature. The list uses a bespoke tag at [InventoryLedger.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/InventoryLedger.tsx:129), and the detail page uses split label/value cells at [page.tsx](/Users/themoreapp/More%20Technologies/projects/the-chain/src/app/(app)/inventory/[productId]/page.tsx:225). The component built to solve this is bypassed on the very surfaces the feature names.

## Decisions / round-1 dispositions (2026-06-10)

This was a FULL-weight review of wave 1 of a multi-wave block; much of "what wasn't done" is later-wave
scope deliberately deferred (forecasting is wave 2; the heavier quadrant interactions are wave 1b).

**Fixed now:**
- **`revenue_basis` was faked** — persisted the threshold's stated basis while always computing cost.
  Now persists `'cost'` (the basis actually used; no price source exists). Honest.
- **delete-then-insert could wipe a tenant's classifications** if the insert failed — reordered to
  insert-the-new-snapshot-FIRST, then delete everything not stamped with this run's `computed_at`;
  `loadQuadrant` dedupes to the newest snapshot per SKU, so a failed delete can't double-count either.
  Crash-safe without a migration.
- **Canonical `ClassificationBadge` was bypassed** — the inventory list reimplemented a private
  `ClassTag` and the detail panel rendered raw chars. Both now use `ClassificationBadge` (deleted the
  duplicate). Satisfies the "badge row on list + detail" part of the contract; kills UI drift.
- **No action-layer test** — added `tests/classification/recompute-action.test.ts` (owner/manager
  pass, member/no-tenant refused without running the engine).

**Pushed back (with evidence):**
- **`cold_start_state='cold'` not set** — that enum lives on the `forecasts` table
  (`init_forecasting.sql:19`), not `product_classifications`. It's the FORECAST eligibility concept
  (wave 2). The classification-side analog (no demand signal → `awaitingSignal`) is shipped.
- **A/X "where the money is" vs A/B·Z watch corner** — the watch corner (valuable + erratic) is the
  operationally useful highlight, and MG approved it 2026-06-10. The A/X focus can be an additional
  treatment in the zoom wave.
- **font/layout px "drift"** — font-size + clip + layout-min px match the established components
  (`Panel`, `StatNumber`); motion + spacing already use `--duration`/`--ease`/`--spacing` tokens. No
  font-size or breakpoint token exists in `globals.css`.
- **no per-segment loading/error** — the group-level `(app)/error.tsx` covers it; no `(app)` segment
  has its own (house-consistent).

**Ticketed (later waves / infra-blocked):** quadrant drag-zoom + filtered SKU list + URL zoom state
(wave 1b); classification inside `forecastTenantBatchWorkflow` + scheduled run (wave 2); per-location
classification; threshold-version → reclassify trigger + audit replay + threshold editor; forecast-view
method routing (wave 2); p95<1.5s 5k bench + `loadQuadrant` scale query (needs seed-5k); Playwright
quadrant capture (infra-blocked). All in `_reviews/_tickets.md`.
