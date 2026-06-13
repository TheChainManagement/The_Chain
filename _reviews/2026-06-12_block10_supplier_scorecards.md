# Codex Review — block10_supplier_scorecards
**Date:** 2026-06-12 19:25
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block10_supplier_scorecards
**Review weight:** full
**Skills audited:** moretech-codex-review
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The Block 10 slice is real, not vapor. The repo has the pure scorecard math in `src/lib/scorecards/performance.ts:15-146`, the rollup writer in `src/lib/scorecards/rollup.ts:34-80`, the receipt write path in `src/lib/scorecards/receive.ts:58-147`, the PO detail + receive UI in `src/app/(app)/purchase-orders/[poId]/page.tsx:23-124` and `src/app/(app)/purchase-orders/[poId]/ReceiveControls.tsx:17-132`, and the daily cron in `src/app/api/cron/scorecards/route.ts:16-55`.
- The supplier detail surface was actually widened for scorecard data. `src/app/(app)/suppliers/[supplierId]/page.tsx:138-162` now renders OTIF plus on-time / in-full sub-stats and empirical lead time ± sigma, and `src/lib/suppliers/transform.ts:210-240` maps the extra scorecard fields.
- The PO list now links to the new PO detail route instead of dumping the user onto the supplier page, which closes a real navigation hole for receiving. That diff is present in `src/app/(app)/purchase-orders/page.tsx`.
- There is real automated coverage on disk for the math, action gate, and integration path: `tests/scorecards/performance.test.ts`, `tests/scorecards/receive-action.test.ts`, and `tests/scorecards/receive.test.ts`.
- The claimed review artifact for `moretech-codex-review` is present on disk at `_reviews/2026-06-12_block10-supplier-scorecards.md`. The supplied compliance block calling this `no-evidence` was not verified carefully.

## What wasn't done

- The feature contract says to embed scorecards on supplier list, supplier detail, and the reorder recommendation review screen (`FEATURES.md:417-418`). Only supplier detail is real. The supplier list page still shows just OTIF in a ledger cell, not a scorecard/ribbon (`src/app/(app)/suppliers/page.tsx:40-79`), and the reorder flow is still a stub with no review screen at all (`src/app/(app)/reorder/page.tsx:1-14`).
- The required memorable artifact is still off-contract. The feature explicitly calls for a preview screenshot or Playwright interaction, and specifically names a Playwright capture for the scorecard panel (`FEATURES.md:432-434`). What exists on disk is a jsdom/Vitest artifact at `_reviews/2026-06-12_feature_reliability_ribbon_memorable.test.tsx`, not Playwright.
- The partial-receipt checklist item was only half-tested. `tests/scorecards/receive.test.ts:157-179` proves “two rows exist” and stops there. It does not verify that the second row stores the correct per-delivery quantity or verdict, which is exactly where the implementation is wrong.
- There is no evidence in this slice of a delivered reorder recommendation review surface with supplier scorecard context. The evidence file admits “No reorder integration yet” and the repo matches that admission.

## What can be done better

- Stop swallowing admin read failures. `rollupSupplierScorecards()` ignores the select error on `supplier_performance` (`src/lib/scorecards/rollup.ts:40-48`) and will happily derive scorecards from `perf ?? []`. That means a failed read can degrade into writing empty/null rollups instead of failing hard.
- The cron has the same softness problem. `src/app/api/cron/scorecards/route.ts` pages through `supplier_performance` but never checks the select error before deciding whether to continue. A broken query path can look like “0 suppliers” and return `{ ok: true }`.
- The receipt path is still a non-transactional sequence of line updates, PO update, performance insert, and scorecard rollup (`src/lib/scorecards/receive.ts:104-146`). The evidence file already admits this. It is still a real integrity hole, not a harmless note.
- The rolling windows are keyed off `recorded_at`, not the actual delivery date (`src/lib/scorecards/performance.ts:68-83`). Back-enter a late receipt today for a truck that arrived 45 days ago and your 30-day OTIF is wrong. That is the wrong anchor for a supplier performance window.
- Using `purchase_orders.created_at` as the order timestamp for empirical lead time is a weak proxy for imported POs. The evidence file flags this honestly. It is still dirty data feeding policy.

## What was missed

- `src/lib/scorecards/receive.ts:124-143` is recording the wrong delivery facts for partial receipts. The code says “one row per receipt event,” but it computes `receivedTotal` as the cumulative PO received amount (`:87-98`), passes that cumulative value into `assessReceipt` (`:126-131`), and inserts it as `actual_quantity` (`:138-139`). Result: on the second receipt of a 60/40 split, the row says the event delivered 100 and was in-full. That is false. This corrupts `supplier_performance` history and every downstream OTIF rollup.
- The tests missed that exact bug. `tests/scorecards/receive.test.ts:157-179` asserts only that two rows exist for a split receipt. It never inspects the second row’s `actual_quantity`, `in_full`, or `on_time_in_full`. The happy-path integration coverage gives a false sense of safety.
- The scorecard window logic is vulnerable to backdated-entry distortion. `windowRows()` filters by `recordedAt` (`src/lib/scorecards/performance.ts:68-83`), while the feature is explicitly about promised vs actual delivery facts (`FEATURES.md:406-415`). If operators receive old deliveries late, the supplier’s rolling 30/90/365 numbers shift based on entry timing, not delivery timing.
- The feature was declared “surface completed” in the evidence file, but the contract surface is not complete. The supplier list has no ribbon/scorecard embed, and the reorder recommendation review screen does not exist. That is scope drift dressed up as completion.

## Decisions (captured 2026-06-12, dispositioned by Claude per the standing wave cadence — MG to confirm at the session checkpoint)

### Partial receipt records cumulative qty as the per-event actual_quantity (corrupts OTIF history)
- **Decision:** fix now — REAL bug, the sharpest finding. supplier_performance feeds policy + money.
- **Action:** the receipt is now ATOMIC via `receive_purchase_order` RPC (migration `20260612180000`) — clamps + applies per-line received qty under a PO row lock, advances status, and inserts ONE supplier_performance row with the per-EVENT delta. Verified live: a 60/40 split now stores rows of 60 (in_full=false) then 40 (in_full=true, OTIF) — not a phantom 100. Test strengthened to assert the second row's exact actual_quantity/in_full/OTIF.

### Receipt write was a non-transactional sequence (Codex pushed back on "harmless note")
- **Decision:** fix now — the RPC above also closes this. The line updates + status + performance insert are one transaction; the (idempotent) scorecard rollup stays outside. Not ticketed — fixed.

### Rolling windows anchored on recorded_at (entry time), not delivery date
- **Decision:** fix now — REAL distortion (a backdated late-entered receipt would skew today's 30d OTIF).
- **Action:** `windowRows` now filters by `actual_delivery_at` (recordedAt fallback). Regression test: a delivery 200d ago entered today lands in the 365d window, NOT the 30d.

### Swallowed read errors in rollup + cron
- **Decision:** fix now.
- **Action:** `rollupSupplierScorecards` throws on the supplier_performance read error (a swallowed read would silently zero a supplier's OTIF); the cron returns 500 instead of a false `{ok:true, 0 suppliers}`.

### Scorecards not embedded on supplier LIST + reorder-review screen ("surface completed" overclaim)
- **Decision:** soften the claim; list embed = the OTIF headline (consistent with how the list renders every metric as a toned StatNumber); the FULL scorecard (ribbon + on-time/in-full sub-stats + actual lead-time ±σ) is on supplier detail; **the reorder-recommendation-review embed is genuinely Block 11** (that screen does not exist yet — can't embed in a stub). Evidence wording corrected from "surface completed" to "supplier-detail scorecard complete; list shows the OTIF headline; reorder-review embed lands with Block 11."

### Lead time uses purchase_orders.created_at as the order date (weak for imported POs)
- **Decision:** ticket — accepted-with-rationale. Operator-created POs (Block 11) carry the real placement; QBO imports use import time (real TxnDate needs a QBO field). Flagged in code + evidence; tightening tracked.

### Memorable artifact is RTL, not Playwright
- **Decision:** standing pushback (infra-blocked since Block 5). RTL ribbon artifact + the live in-browser receipt (recorded above) is the accepted standard.
