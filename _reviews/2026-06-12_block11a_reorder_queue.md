# Codex Review — block11a_reorder_queue
**Date:** 2026-06-12 20:11
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block11a_reorder_queue
**Review weight:** full
**Skills audited:** moretech-codex-review
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The Block 11a slice is real on disk. The repo has the pure recommendation math in `src/lib/reorder/recommend.ts`, the generation writer in `src/lib/reorder/generate.ts:61-193`, the convert path in `src/lib/reorder/convert.ts:36-60` plus the RPC in `supabase/migrations/20260613120000_block11_convert_recommendations.sql:13-93`, the queue read model in `src/lib/reorder/queue.ts:48-114`, the `/reorder` page in `src/app/(app)/reorder/page.tsx:19-62`, and the server actions in `src/app/(app)/reorder/actions.ts:24-69`.
- Recommendation generation is actually wired into the forecast workflow. `src/workflows/forecast-batch.ts:317-325` calls `generateReorderRecommendations()` immediately after `derivePoliciesForRun()` for the shard slice.
- There is real test coverage on disk for the new slice: `tests/reorder/recommend.test.ts`, `tests/reorder/generate.test.ts`, `tests/reorder/actions.test.ts`, and the memorable artifact `_reviews/2026-06-13_feature_reorder_queue_memorable.test.tsx`.
- The claimed `moretech-codex-review` artifact is not missing. `_reviews/2026-06-13_block11a-reorder-queue.md` exists on disk, so the compliance block calling this `no-evidence` is wrong.

## What wasn't done

- The full feature in `FEATURES.md:447-454` is not delivered. This repo has the recommendation queue and convert-to-PO half, but not step 4 `/app/reorder/po/[poId]`, not step 5 `approvePurchaseOrder(...)` and lifecycle workflow, not step 6 the reorder receive flow that writes `stock_movements` and `inventory_levels`, and not step 7 CSV export. The evidence file admits this is only “Wave 11a” at `_reviews/2026-06-13_block11a-reorder-queue.md:65-71`.
- The required memorable artifact for the full reorder workflow is still absent. `FEATURES.md:469-471` calls for a visible preview screenshot or Playwright interaction around the PO chain hero moment. What exists is a jsdom RTL test for the queue at `_reviews/2026-06-13_feature_reorder_queue_memorable.test.tsx`, which is not that artifact.
- The contract says the recommendation generation step belongs inside `alertGenerationWorkflow` post-forecast (`FEATURES.md:448`). What shipped is a direct call from `forecastShardWorkflow` in `src/workflows/forecast-batch.ts:317-325`. If that architecture change was intentional, it was not documented as such.

## What can be done better

- The DB error handling is soft where it should be hard. `src/lib/reorder/generate.ts:82-102` ignores read errors from `inventory_levels`, `products`, and `reorder_recommendations`; `src/lib/reorder/generate.ts:143-155` and `181-188` ignore update errors; `src/lib/reorder/queue.ts:48-68` ignores read errors for both recommendations and supplier scorecards. That is how you get false “success” with stale or partial queue state.
- The review evidence oversells the selection model. `_reviews/2026-06-13_block11a-reorder-queue.md:38-44` says selection is fenced to one supplier group, but the backend contract in `src/lib/reorder/convert.ts:7-14` is supplier and location. The evidence should have called that out instead of treating supplier-only fencing as sufficient.
- The test suite is too single-path. `tests/reorder/generate.test.ts` only seeds one location and one supplier. `_reviews/2026-06-13_feature_reorder_queue_memorable.test.tsx:37-84` also uses only same-location groups. That is why the real failure mode below slipped through.
- The queue read model is too lossy. `src/lib/reorder/queue.ts:117-126` fabricates default reason values for malformed rows instead of surfacing bad data. That keeps the page pretty, but it hides broken recommendations.

## What was missed

- The queue can present an impossible selection set. `src/lib/reorder/queue.ts:74-99` groups rows only by `supplier_id`, and `src/app/(app)/reorder/ReorderQueue.tsx:40-58` fences selection only by that supplier group. But the actual convert contract rejects mixed locations: `src/lib/reorder/convert.ts:7-14` and `supabase/migrations/20260613120000_block11_convert_recommendations.sql:47-49`. Same supplier, two locations, click “Select all”, and the UI happily lets the user build a set the backend must bounce with `mixed_location`. That is not an edge case; multi-location is core product shape.
- The tests completely missed that multi-location failure. The memorable artifact uses one location everywhere (`_reviews/2026-06-13_feature_reorder_queue_memorable.test.tsx:47,57,75`), and the integration test seeds only one warehouse (`tests/reorder/generate.test.ts:89-105`). There is no test proving the queue partitions by location or blocks cross-location conversion.
- Generation can silently lie about success. In `src/lib/reorder/generate.ts:143-155`, the update of an existing recommendation does not inspect the returned `error` at all, but `summary.updated++` still increments. Same problem on expire at `181-189`. If Supabase rejects the write, the caller still gets a clean summary and the UI can show “recomputed” even though nothing landed.
- Queue loading can silently collapse to empty or stale state. `src/lib/reorder/queue.ts:48-68` discards errors from both queries. A failed `reorder_recommendations` read becomes `[]`, which drives the empty-state panel in `src/app/(app)/reorder/page.tsx:50-57`. That means a transient DB failure can render “Nothing to reorder” instead of an error. That is a dangerous lie on the product’s primary action loop.

## Decisions (captured 2026-06-13, dispositioned by Claude per the standing wave cadence — MG to confirm at the session checkpoint)

### Queue groups/fences by supplier ONLY, but convert rejects mixed location (impossible selection set)
- **Decision:** fix now — REAL bug, and multi-location is core product shape (wire-for-full-vision).
- **Action:** the queue read model now groups by **(supplier, location)**; the UI fences selection by the composite key and shows the location on every group when the tenant is multi-location. `reorderGroupKey` is the shared key. Integration test seeds a second location and proves the queue partitions + a cross-location convert is rejected; the memorable artifact adds a same-supplier/two-location case asserting separate groups + no cross-location mix.

### Soft DB error handling (generate + queue swallow read/update/expire errors → false success)
- **Decision:** fix now — a swallowed read renders "Nothing to reorder" on the PRIMARY action loop, a dangerous lie.
- **Action:** `generateReorderRecommendations` throws on the input reads, the in-place update, and the expire; `loadReorderQueue` throws on both the recommendation read and the scorecard read. A transient DB failure now surfaces via the error boundary, never a fake-empty queue or a fake "recomputed".

### Evidence oversold the selection model (said "supplier" fencing, contract is supplier+location)
- **Decision:** fixed by the change above — fencing is now genuinely (supplier, location), matching the contract. Evidence corrected.

### Lossy reason normalization hides bad rows
- **Decision:** keep with rationale (low-priority). The engine always writes a complete reason; `normalizeReason` is defense for hand-written/legacy rows, not a place bad data hides (a malformed reason still renders, just with safe zeros). Not load-bearing; revisit if a reason-integrity issue ever appears.

### Not the full feature / memorable artifact is the PO-chain hero
- **Decision:** standing wave framing — this is Wave 11a (recommendation→queue→PO). The PO-chain hero moment (cobalt flowing into RECEIVED) + approve + receive-writes-stock + CSV export are **Wave 11b**, explicitly scoped in the evidence. Consistent with every prior block shipping in waves.

### Generation step in forecastShardWorkflow, not a separate alertGenerationWorkflow
- **Decision:** intentional, now documented. Recommendations derive directly from the policy, which derives in the shard — co-locating avoids a second full catalog pass and a second workflow. `alertGenerationWorkflow` doesn't exist yet; when the alerts engine lands, breach-alerting can join it. Noted in the evidence.

### Memorable artifact is RTL, not Playwright
- **Decision:** standing pushback (infra-blocked since Block 5). RTL + the live in-browser convert (recorded in the evidence) is the accepted standard.
