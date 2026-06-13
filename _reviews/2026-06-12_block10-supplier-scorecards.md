# Evidence — block10_supplier_scorecards

**Date:** 2026-06-12
**Project:** The Chain
**Phase:** 6 (Features) · Block 10 (Supplier reliability scorecard) · Tranche D
**Unit:** PO receipt → supplier_performance → scorecard rollup → empirical lead time + the lit ribbon

---

## Goal

Make suppliers accountable: capture every delivery's promised-vs-actual facts on PO receipt,
roll them into OTIF / on-time / in-full percentages and an empirical lead time per window, and
feed that realized lead-time σ back into the Block 9 safety-stock formula. The visible payoff:
Block 4 built the reliability ribbon but left it DIM — Block 10 is the producer that LIGHTS it.

## What was built (the producer; the display side was Block 4, data-blocked)

1. **Pure math (`src/lib/scorecards/performance.ts`)** — `assessReceipt` (on-time =
   delivered ≤ promised by day; in-full = received ≥ ordered; OTIF = both; a null promise →
   timing unknown, OTIF falls back to in-full — never invent a promise); `rollupWindow`
   (OTIF/on-time/OTIF over TIMED rows so an unjudgeable delivery can't lower the timing rate;
   in-full over all; lead-time avg + POPULATION stddev = the σ_L the policy consumes);
   `windowRows` (rolling 30/90/365d + all-time); `leadTimeDays` (realized order-to-door,
   rejects a delivery before the order).

2. **Rollup engine (`src/lib/scorecards/rollup.ts`, server-only)** — refreshes all four
   `supplier_scorecards` windows for a supplier from its `supplier_performance` joined to the
   PO order date (for realized lead time). Upserts on the (tenant, supplier, window) PK via
   the service-role admin client (scorecards are system-write). Runs after a receipt + the
   daily cron.

3. **Receipt core (`src/lib/scorecards/receive.ts` + `receive_purchase_order` RPC,
   server-only)** — `receivePurchaseOrder` calls the ATOMIC RPC (migration `20260612180000`):
   under a PO row lock it clamps + applies per-line received qty, sets status (partial vs
   full) + actual_delivery_at, and writes ONE `supplier_performance` row with the per-EVENT
   delta quantity (FEATURES partial-receipt rule: two delivery dates → two rows of the right
   sizes). Then the (idempotent) scorecard rollup runs. Refuses a terminal PO.

4. **`markPurchaseOrderReceived` action** (owner|manager|planner — the PO write role set) +
   the **PO detail route `/purchase-orders/[poId]`** (the standing "no PO detail route" ticket
   from 6.3-A, now closed): the OrderChain header, the lines table (ordered/received, links to
   SKUs), and the `ReceiveControls` disclosure (delivery date + per-line qty, defaulted to the
   outstanding remainder). Cockpit ledger rows now link here.

5. **Scorecard surface (supplier detail) completed** — the supplier detail's reliability ribbon LIGHTS from real
   outcomes (cobalt OTIF / amber short / stop late); the Terms panel gains **on-time % +
   in-full % sub-stats** and a **lead time (actual) ± σ · N POs** cell (FEATURES named these;
   only OTIF rendered before). Scorecard read widened (`on_time_pct`, `in_full_pct`,
   `lead_time_stddev_days`).

6. **Daily rollup cron** `/api/cron/scorecards` (`vercel.json` `30 7 * * *`, Bearer
   CRON_SECRET) — re-rolls every supplier with history so the rolling windows stay current
   without a new delivery.

7. **Feedback loop activated** — the Block 9 `chooseLeadTime` already preferred the scorecard
   at sample_size ≥ 5; now scorecards exist to trigger it. No new policy code; proven by test.

## Verification

- **Suite 479/479** (26 new: performance math 14, receipt+rollup integration 4, receive-action
  5, ribbon-memorable 3). tsc/biome/build clean (`/purchase-orders/[poId]` +
  `/api/cron/scorecards` in the route table).
- **Live (Riverbend Hardware):** seeded an open PO, opened `/purchase-orders/[poId]` (chain +
  line + receive control), set the delivery date before the promise, confirmed full receipt →
  status advanced to **Received**. DB: one `supplier_performance` row (on_time/in_full/OTIF all
  true), all four scorecard windows rolled (OTIF 100%, lead time 5.99d realized). Supplier
  detail (screenshot reviewed): the previously-dim ribbon's first tile lit **cobalt OTIF**,
  **OTIF (30d) 100%** flow-green with **on-time 100% / in-full 100%** sub-stats and **lead time
  5.99d ±0σ · 1 PO**. Console clean.
- **The empirical-lead-time loop** is proven by the integration test: 5+ receipts → all-time
  scorecard sample_size ≥ 5 → `chooseLeadTime(14, scorecard)` returns `source: 'scorecard'`
  with the realized avg as the lead time. (Doing this live needs 5 receipts; the test is the
  deterministic record.)

## Honest scope notes

- **Reliability is computed from `supplier_performance` history, never a user field** (FEATURES
  acceptance) — the receive form captures the raw delivery facts; the flags are derived.
- **Lead time uses the PO's `created_at` as the order reference.** For operator-created POs
  (Block 11) that's the placement; for QBO-imported POs it's the import time (real TxnDate
  would need a QBO field — out of scope, noted). Acceptable for MVP; flagged.
- **Receipt writes ARE atomic** (Codex round-1): line updates + status + the per-event
  performance row run in one transaction under a PO row lock inside `receive_purchase_order`.
  The scorecard rollup (idempotent recompute) runs after, outside the txn — safe.
- **Supplier list embed = the OTIF headline** (toned StatNumber, consistent with the list's other metrics); the full ribbon + sub-stats live on supplier detail; the reorder-recommendation-review embed is Block 11 (that screen does not exist yet). Corrected from an earlier 'surface completed' overclaim.
- **No reorder integration yet** — Block 11 (reorder recommendations → PO) is the next tranche;
  this block makes the *receive* end real so scorecards have data before reorder ships.
- Over-receipt is clamped to exactly full (never beyond ordered); a short final receipt leaves
  the PO `partial_received` until the rest lands.
