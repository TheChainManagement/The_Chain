# Evidence — Block 11b: approve → QBO write-back + receive-writes-stock

**Date:** 2026-06-13
**Phase:** 6 (Features)
**Feature:** Reorder workflow + PO lifecycle (the second half — Block 11a shipped recommend → draft PO)

## What was built

The product's primary action loop now closes end to end: a draft PO (from 11a's
convert) can be **approved** (written back to QuickBooks when connected, else
marked for manual export, committing the ordered qty as in-transit stock) and
**received** (moving in-transit → on-hand, writing the receipt ledger the
forecast reads), with a durable workflow owning the long wait between.

### Data layer
- `supabase/migrations/20260613130000_block11b_approve_receive_stock.sql`
  - `po_receipt_events` — receipt idempotency ledger (unique `(tenant_id, idempotency_key)`) + its audit trigger.
  - `apply_po_approval(...)` — atomic draft → sent|exported under a row lock; `inventory_levels.in_transit += ordered_qty` per line; idempotent on PO status; persists QBO external ids.
  - `receive_purchase_order(...)` **v2** — same atomic txn now ALSO writes `stock_movements` (type=receipt, source=workflow), moves `on_hand += delta` / `in_transit -= delta`, and is **idempotent** on a caller key (the Block 10 checklist item that was deferred). Old 4-arg signature dropped.

### Logic + durability
- `src/lib/purchase-orders/approve-core.ts` — assembles the canonical PO payload from `external_ids->>'qbo'`, calls the existing idempotent `adapter.push()`, degrades to `exported` if not connected / unmapped, runs the approval RPC.
- `src/lib/scorecards/receive.ts` — threads the idempotency key, handles the replay (`out_applied=false`) path.
- `src/workflows/po-lifecycle.ts` — `purchaseOrderLifecycleWorkflow`: parks on the deterministic receipt hook (`po-<id>-receipt`), finalizes on full receipt. Survives crash / redeploy / months-long gap.
- `src/lib/purchase-orders/finalize.ts` — terminal step (integrity read + the documented Block 12 insight seam).
- `src/lib/purchase-orders/lifecycle-token.ts` — the shared deterministic token.

### UI (the visible delta)
- `ApproveControls` on the draft PO; approving floods cobalt to IN TRANSIT.
- The terminal RECEIVED link now FILLS cobalt on completion (`ChainLink` `celebrate` + `OrderChain`) — the spring-physics payoff. Logical state stays `done`.
- `/api/exports/po/<poId>.csv` export route (+ pure `purchaseOrderToCsv`).
- Order total now renders through `<StatNumber>` (MASTER_PROMPT trust hierarchy).

## Skills invoked
- `vercel:workflow` — consulted for the v4 `createHook` / `resumeHook` API + `@workflow/vitest` testing harness (training data was stale; read bundled docs).
- `moretech-codex-review` — adversarial review run (Phase 6, full weight). Review at `_reviews/2026-06-13_block11b_approve_receive_stock.md`; decisions appended there.

## Verification
- **Tests:** full suite **521 passed** (was 506; +15) + **2 workflow integration** (`vitest.integration.config.ts` with `@workflow/vitest`). Typecheck + biome clean.
  - DB-real: receive writes stock + on_hand (`tests/scorecards/receive.test.ts`), idempotency no-double-count, approve → exported + in_transit (`tests/purchase-orders/approve-core.test.ts`), finalize (`tests/purchase-orders/finalize.test.ts`).
  - Action-path: approve role/billing gate + workflow start (`tests/purchase-orders/approve-action.test.ts`), receive (`tests/scorecards/receive-action.test.ts`).
  - Workflow: hook park + resume + per-PO token isolation (`tests/workflows/po-lifecycle.integration.test.ts`).
- **Migration:** full chain re-applied clean via `supabase db reset` (block11b applies on a fresh DB).
- **Live browser (memorable artifact):** seeded a draft PO, signed in, and drove the real app:
  - **Draft** → ORDERED ignited cobalt, Approve control + Export CSV present.
  - **Approve** → status DRAFT → EXPORTED (no QBO connection on the demo tenant — correct fallback), control became "Receive delivery".
  - **Receive** → status RECEIVED, received qtys in flow-tone (120/120, 80/80), Delivered date, and the **RECEIVED link filled cobalt** (`data-complete="true"`).
  - Memorable test guard: `_reviews/2026-06-13_feature_po_lifecycle_memorable.test.tsx` (3 assertions, green).
  - No console errors on the PO detail page.

## Post-review fixes applied in-slice (from the Codex review)
- Approve copy no longer claims it always writes to QuickBooks (states the export fallback).
- `past_due` / `canceled` billing gate added to `approvePurchaseOrder` (FEATURES §Trial-expiration) + test.
- Order total rendered through `<StatNumber>`.
- Memorable artifact moved on-contract (live browser capture + `_reviews/` test).

Deferred items ticketed in `_reviews/_tickets.md`.
