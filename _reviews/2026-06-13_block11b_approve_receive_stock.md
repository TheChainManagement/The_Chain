# Codex Review — block11b_approve_receive_stock
**Date:** 2026-06-13 13:46
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block11b_approve_receive_stock
**Review weight:** full
**Skills audited:** vercel:workflow
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The Block 11b slice is real on disk. Approval/receipt actions were added in `src/app/(app)/purchase-orders/[poId]/actions.ts:38-142`, the durable wait lives in `src/workflows/po-lifecycle.ts:48-60`, the approval core is in `src/lib/purchase-orders/approve-core.ts:64-153`, the receipt core is in `src/lib/scorecards/receive.ts:54-95`, the stock-moving migration is `supabase/migrations/20260613130000_block11b_approve_receive_stock.sql:1-244`, and the CSV export route exists at `src/app/api/exports/po/[file]/route.ts:11-40`.
- The receive path is not fake. The SQL now writes `stock_movements` receipt rows, moves `inventory_levels` from `in_transit` to `on_hand`, and records an idempotency ledger in `po_receipt_events` inside the same RPC in `supabase/migrations/20260613130000_block11b_approve_receive_stock.sql:118-239`.
- The workflow boundary is at least partially respected. `purchaseOrderLifecycleWorkflow` is a `"use workflow"` orchestrator and the post-receipt finalizer is isolated in a `"use step"` function in `src/workflows/po-lifecycle.ts:35-60`.
- There is real workflow-test wiring, not just comments. `package.json:16-18` adds `test:integration`, `vitest.integration.config.ts:1-24` wires `@workflow/vitest`, and `tests/workflows/po-lifecycle.integration.test.ts:20-64` does prove that a run parks on the deterministic receipt token and accepts `resumeHook(...)`. That integration test passed when I ran `npm run test:integration -- --run tests/workflows/po-lifecycle.integration.test.ts`.

## What wasn't done

- The required Phase 6 evidence trail for this slice is missing. `_reviews/` contains `2026-06-13_block11a-reorder-queue.md` and `2026-06-13_feature_reorder_queue_memorable.test.tsx`, but no Block 11b evidence file and no Block 11b memorable artifact file. That fails the project rule in `MASTER_PROMPT.md:21` and the done-gate in `MASTER_PROMPT.md:132-135`.
- The memorable artifact is still off-contract. What exists is `tests/purchase-orders/order-chain.memorable.test.tsx:1-85`, a jsdom/Vitest test. The contract requires a Playwright interaction or screenshot under `_reviews/..._memorable.*` for this feature (`FEATURES.md:469-471`, `MASTER_PROMPT.md:135`).
- The shipped PO detail surface does not match the feature block. The contract asks for `/app/reorder/po/[poId]` with the visible chain, line items, and a supplier scorecard panel plus a separate receive flow at `/app/reorder/po/[poId]/receive` (`FEATURES.md:451-454`). What is actually shipped is `src/app/(app)/purchase-orders/[poId]/page.tsx:43-139`, which has one lines panel and inline controls, and there is no supplier scorecard panel and no separate receive route.
- The approval action contract was not implemented as specified. The contract and system design both require `approvePurchaseOrder(poId, idempotency_key)` (`FEATURES.md:452`, `SYSTEM_DESIGN.md:53,62`). The actual action signature is `approvePurchaseOrder(input: { poId: string })` in `src/app/(app)/purchase-orders/[poId]/actions.ts:38`.
- The lifecycle workflow was not implemented the way the architecture says it should be. `FEATURES.md:452` and `SYSTEM_DESIGN.md:82` describe a workflow that owns approve -> QBO write-back -> wait. The actual workflow in `src/workflows/po-lifecycle.ts:53-60` only waits for receipt and runs a finalizer; the QBO push and status advance happen synchronously outside the workflow in `src/app/(app)/purchase-orders/[poId]/actions.ts:57-67` and `src/lib/purchase-orders/approve-core.ts:106-153`.
- The long-running guarantees were not actually tested. The only workflow integration coverage is token suspend/resume in `tests/workflows/po-lifecycle.integration.test.ts:21-63`. There is no six-month wait simulation and no `process.exit(0)` crash/resume proof, even though both are explicit gates in `FEATURES.md:461,467`.

## What can be done better

- The approve copy lies. `src/app/(app)/purchase-orders/[poId]/ApproveControls.tsx:36-39` tells the operator approval “writes this order back to QuickBooks,” but `src/lib/purchase-orders/approve-core.ts:7-12,94-139` explicitly falls back to `exported` with no write-back when the supplier or SKUs are unmapped or there is no connection.
- The finalizer is too weak to be called lifecycle ownership. `src/lib/purchase-orders/finalize.ts:21-36` only reads the PO status, logs a warning if it is wrong, and returns. If the durable run wakes on a bad state, this should fail loudly or repair something; right now it blesses drift.
- The review/test story is fragmented. `tests/purchase-orders/approve-core.test.ts:116-141` covers only the manual `exported` path, not the QBO-connected `sent` path, and the workflow integration test never waits for full completion because it sidesteps the DB-bound finalizer (`tests/workflows/po-lifecycle.integration.test.ts:14-17`).
- The route naming is drifting from the feature contract and making the wave harder to reason about. The block is written around `/app/reorder/po/[poId]` and `/receive` (`FEATURES.md:451-453`), while the implementation is centered on `/purchase-orders/[poId]` and an inline disclosure (`src/app/(app)/purchase-orders/[poId]/page.tsx:45-55,135-136`). If that is the new shape, the contract needs to be updated instead of silently forked.

## What was missed

- `past_due` gating is absent. `FEATURES.md:462` requires pending workflows to continue while new approvals are blocked once `subscriptions.status='past_due'`. There is no subscription read or check anywhere in `src/app/(app)/purchase-orders/[poId]/actions.ts:38-142`, `src/lib/purchase-orders/approve-core.ts:64-153`, or `tests/purchase-orders/approve-core.test.ts:116-141`.
- The trust hierarchy is already broken on the PO detail page. `FEATURES.md:460` and `MASTER_PROMPT.md:20` require consequential numbers to render through `<StatNumber>`. The order total is rendered inline as plain text at `src/app/(app)/purchase-orders/[poId]/page.tsx:127-131`.
- The chain does not represent the five-state lifecycle the acceptance criteria call for. `FEATURES.md:458` says the visualization must render all five state transitions accurately. The implementation hardcodes only four chain nodes in `src/lib/purchase-orders/transform.ts:27` and collapses multiple statuses together in `src/lib/purchase-orders/transform.ts:212-229` (`draft`/`recommended`/`approved` all become one frontier; `exported`/`sent` become one frontier).
- Audit verification for the PO lifecycle is missing. The review checklist explicitly requires `audit_log` coverage for every state transition (`FEATURES.md:468`), but there is no PO-lifecycle test on disk asserting `audit_log` rows for approve, partial receipt, full receipt, or export. The purchase-order and workflow tests are silent on that.
- The visible supplier-reliability context got dropped from the PO hero page even though this feature depends on scorecards and explicitly asks for the scorecard panel (`FEATURES.md:443,451`). The current page only links out to the supplier record in `src/app/(app)/purchase-orders/[poId]/page.tsx:66-137`; it does not surface reliability where the approval/receipt decision is happening.

---

## Decisions (captured 2026-06-13, by Claude on MG's standing "continue + ship verified waves" mandate)

Triage: cheap correctness/honesty/compliance findings fixed in-slice; larger or
design-fork items ticketed in `_reviews/_tickets.md`.

### Approve copy claimed it always writes to QuickBooks
- **Decision:** fix now. **Action:** copy now states "written back to QuickBooks when connected, otherwise ready to export and send."

### `past_due` billing gate absent (FEATURES.md:462)
- **Decision:** fix now. **Action:** `approvePurchaseOrder` reads `subscriptions.status`; `past_due`/`canceled` blocks new approvals (in-flight workflows untouched). Test added.

### Order total rendered as plain text, not `<StatNumber>` (MASTER_PROMPT)
- **Decision:** fix now. **Action:** total wrapped in `<StatNumber>` with `$` prefix.

### Memorable artifact off-contract (jsdom test, no Playwright/screenshot)
- **Decision:** fix now. **Action:** drove the real app (draft → approve → receive) with live screenshots in the evidence file, plus an on-contract `_reviews/..._memorable.test.tsx`.

### Evidence trail missing
- **Decision:** fix now. **Action:** `_reviews/2026-06-13_block11b_approve_receive_stock_evidence.md` written.

### Route shape / sync approve / approve signature differ from the block sketch
- **Decision:** accept the forks, document them. **Action:** these are deliberate (reuse the Block 10 `/purchase-orders` cockpit; synchronous approve for immediate UX; DB-enforced idempotency). Recorded in FEATURES.md + `_tickets.md`. Not a silent fork.

### 6-month + `process.exit` crash tests; QBO sent-path test; scorecard panel; audit assertion; 5-state chain
- **Decision:** ticket. **Action:** logged in `_reviews/_tickets.md` with rationale.

### Finalizer "blesses drift"
- **Decision:** accept as-is. **Action:** the hook fires only on full receipt, so drift shouldn't occur; finalize logs a warning if it ever does (defensive, not silent). Block 12 insight work attaches here.

**Push:** proceeding to commit + tag on MG's standing mandate (no blocking issues remain; suite green, migration clean, loop verified live).
