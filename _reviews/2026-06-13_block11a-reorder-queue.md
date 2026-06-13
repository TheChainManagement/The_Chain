# Evidence — block11a_reorder_queue

**Date:** 2026-06-13
**Project:** The Chain
**Phase:** 6 (Features) · Block 11 (Reorder workflow + PO lifecycle) · Wave 11a
**Unit:** Recommendation generation + the reorder queue + convert-to-PO — the product's primary action loop

---

## Goal

Close the inbound→outbound chain on the recommendation side: every SKU at or below its
reorder point (the Block 9 policy) becomes a defensible reorder recommendation, the queue
shows the WHY, and an operator turns a same-supplier set into a purchase order in one move.
(11b brings approve → QBO write-back via the adapter's tested `push()` + receive-writes-stock.)

## What was built

1. **Pure breach math (`src/lib/reorder/recommend.ts`)** — `isBreached` (position ≤ reorder
   point), `recommendFor` (qty = max(policy ROQ, shortfall-to-clear-the-breach), whole units;
   reason jsonb = position / reorder point / safety stock / DOS / shortfall / forecast id —
   the operator's "why"), `urgency`/`urgencyRank` (stockout > below-safety > at-reorder).

2. **Generation engine (`src/lib/reorder/generate.ts`, server-only)** — reads
   `inventory_policy` + on-hand position per (product, location), writes an OPEN
   recommendation for every breach. **Idempotent + non-duplicating:** an existing open row
   for the same key is UPDATED in place (version bumps), a recovered SKU's open row is
   EXPIRED; converted/dismissed rows are never touched. Runs as a step **after policy
   derivation in each forecast shard** (FEATURES: recommendation generation post-forecast) and
   on demand.

3. **Convert (`src/lib/reorder/convert.ts` + `convert_recommendations_to_po` RPC, migration
   `20260613120000`)** — atomically promotes OPEN same-supplier/same-location recommendations
   to one DRAFT PO (one line each, unit_cost from the primary supplier link, total summed),
   flips them to `converted` under row locks so a recommendation can't be double-converted and
   a concurrent double-submit can't mint two POs. Rejects mixed supplier/location/no-supplier.

4. **`/reorder` queue** — recommendations grouped by **(supplier, location)** — a PO is one
   vendor AND one location — each group headed by the supplier's **rolling-30d OTIF** (the
   Block 10 scorecard embed FEATURES asks for on the reorder review). Rows: SKU + toned urgency
   + the reason line + order qty. Select a same-group set (selection fences to ONE group; the
   location shows on each group when the tenant is multi-location) → **Create purchase order**
   (the cobalt intent) → routed to the new PO. `recomputeReorders` (manager) refreshes;
   `convertSelectedToPo` (planner+) is the write. Metric strip (to-reorder / out-of-stock /
   suppliers).

## Verification

- **Suite 506/506 (after Codex round-1)** (40 new: recommend math 11, generate+convert integration 4, action-path 6,
  queue memorable 5 + the prior blocks). tsc/biome/build clean (`/reorder` in the route table).
- **Live (Riverbend Hardware):** set RVB-1107 to a stockout (position 0) and RVB-2214 below
  its reorder point (16 vs 43.05); **Recompute → "2 to reorder · 2 new · 0 cleared"**, the
  queue rendered one Atchafalaya group (**OTIF 66.7%** from the real Block 10 scorecard) with
  rows "OUT OF STOCK · 0 on hand vs 67.43 reorder point · 42.6d" and "AT REORDER · 16 on hand
  vs 43.05 · 23.9d", order qty 319 / 137 (screenshot reviewed). Selected all → Create purchase
  order → routed to `/purchase-orders/<id>`, a **draft PO, recommended_by=system, $1966.76,
  2 lines**; both recommendations flipped to **converted** (a re-convert is rejected). Console
  clean.
- **Memorable artifact:** `_reviews/2026-06-13_feature_reorder_queue_memorable.test.tsx` (RTL)
  — reasons + toned urgency visible, (supplier, location) grouping with OTIF, **selection
  fenced to one group** incl. a same-supplier/two-location case (separate groups, no
  cross-location mix), convert fires with exactly the selected ids, CTA disabled until selected.

## Codex round-1 (2026-06-13, review `_reviews/2026-06-12_block11a_reorder_queue.md`)

Fixed in-slice — the big one was REAL: the queue grouped/fenced selection by **supplier only**
while the convert contract rejects **mixed location**, so a same-supplier/two-location "Select
all" built a set the backend must bounce. Now grouped + fenced by **(supplier, location)** end
to end, with a multi-location integration test (queue partitions + cross-location convert
rejected) and a memorable-artifact case. Also fixed: **fail-loud DB errors** in
`generateReorderRecommendations` (reads + update + expire) and `loadReorderQueue` (both reads) —
a swallowed read previously rendered "Nothing to reorder" on the primary loop. Pushed back per
precedent: full-feature/PO-chain-hero memorable (Wave 11b), generation-in-shard vs a separate
alertGenerationWorkflow (intentional, documented), Playwright (infra-blocked). Decisions appended.

## Honest scope notes

- **This is Wave 11a** — the recommendation→queue→PO half. **Wave 11b** brings
  `approvePurchaseOrder` → the durable `purchaseOrderLifecycleWorkflow` (QBO write-back via the
  adapter's built-and-tested-but-unused `push()`, status advance) and extends the receive path
  to write `stock_movements` (type=receipt) + bump `inventory_levels.on_hand` so received stock
  feeds DOS/stockout (FEATURES step 6 — a real gap today: Block 10's receive updates the PO +
  scorecard but NOT on-hand). Also deferred to 11b/tickets: the `createHook` long-running
  lifecycle (6-month pending-PO resume), CSV export, the past_due-subscription approve guard.
- **Recommendations need a policy.** Only SKUs with an `inventory_policy` row (i.e. a promoted
  forecast, Block 9) can breach. Warming/cold SKUs don't generate recommendations — no orders
  from unproven demand.
- **A breached SKU with no supplier** still surfaces (urgency + reason) but in a non-convertible
  group labeled "Assign a supplier to order these" — honest, not hidden.
- The generation step runs per shard inside the forecast batch; the manual Recompute covers the
  whole tenant on demand (so a position change between batches is actionable immediately).
