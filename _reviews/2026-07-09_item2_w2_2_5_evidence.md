# Item 2 — W2-2.5 inventory-core hardening — build evidence (2026-07-09)

Branch `feature/item2-w2-2-5-core-hardening` off main `9d50726`. Built the same
evening Item 1 shipped to prod, immediately after MG locked the three ⛔
decisions (recorded in `docs/NEXT_SESSION_KICKOFF_PROMPT.md` Status).

## MG-locked decisions driving this slice
1. **Fractional stock quantities ALLOWED on conversion remainders** — numeric,
   no forced rounding; the receive UI flags remainders.
2. **Held stock COUNTS in valuation** (still owned), **EXCLUDED from reorder /
   available-to-promise** (position = on_hand − on_hold + in_transit − allocated).
3. **Hold/release ships WITH UI** this wave.

## What was built

### Migrations (3, applied LOCAL only — prod waits for the merge gate)
- `20260709210000_w2_2_5a_hold_release_enum.sql` — `hold` + `release` movement
  types (enum-add split per the w2_2a precedent).
- `20260709210100_w2_2_5b_inventory_core.sql` — the core:
  - 2a columns: `product_suppliers.purchase_uom` + `purchase_to_stock_factor`
    (CHECK > 0); semantics: 1 purchase unit = factor stock units; unit_cost is
    per PURCHASE unit when a factor is set.
  - 2b/2c columns: `inventory_levels.avg_unit_cost numeric(14,4)`,
    `avg_cost_provenance` (seeded|posted), `on_hold` (>= 0, sub-bucket of
    on_hand). CHECKs for hold/release positive qty.
  - **2d THE POSTING KERNEL: `post_stock_movement()`** — validates the type
    contract, writes the ledger row, moves the balance (incl. moving-average
    on costed receipts + the hold bucket) atomically under the level row lock.
  - **`record_stock_movements()`** — the kernel's set-based, balance-NEUTRAL
    ingestion door for CSV/QBO historical movements (idempotent on the dedup
    key).
  - Rewritten through the kernel: `receive_purchase_order` v3 (purchase-UoM
    conversion + line-cost → moving average), `apply_po_approval` v2
    (in_transit commits in STOCK units), `convert_recommendations_to_po` v2
    (orders in purchase UoM, fractional allowed), `post_issue_movements`,
    `post_stock_adjustment`, `close_cycle_count_session`, NEW
    `post_stock_hold`, `onboarding_seed_first_product` v2 (now posts its
    opening balance as an `onboarding_seed` adjustment — the one writer that
    previously moved a balance with no ledger row).
  - `link_supplier` v2 (+purchase_uom, +factor), `inventory_valuation_v` +
    `inventory_valuation_totals_v` (security_invoker) + `inventory_list_v`
    gains on_hold/total_value; avg-cost seed from primary supplier links.
  - **Enforcement: member RLS write policies DROPPED on `inventory_levels`
    (insert/update) and `stock_movements` (insert).** Balances mutate only via
    the service-role kernel path; the action-gate role checks are the
    authorization (role-matrix test updated to assert the NEW contract).
- `20260709211000_w2_2_5c_import_link_purchase_uom.sql` —
  `import_product_supplier_links` carries the two new fields.

### TypeScript
- `src/lib/inventory/post-movement.ts` — kernel TS façade (`postStockHold`,
  `recordStockMovements`). CSV import (sync + durable) and QBO sync (initial +
  incremental) all swapped from direct `stock_movements` upserts to the
  ingestion door. Onboarding action moved to the admin client + p_tenant.
- `src/lib/inventory/position.ts` — **the ONE position helper**
  (`netPosition`): reorder generation, policy derivation, and what-if all use
  it; SKU-detail per-location `available` also subtracts on_hold.
- Supplier link form + `link_supplier` action + import lane
  (`PRODUCT_SUPPLIER_FIELDS`, canonical Zod, link writer with `bad_conversion`
  row errors) carry purchase UoM + factor end to end (both-or-neither +
  factor > 0 validation).
- UI: **ValuationStrip** on /inventory (INVENTORY VALUE · HELD VALUE · NO COST
  YET + valuation CSV export at `/api/exports/inventory/valuation`);
  **conversion rail** in ReceiveControls (live `× factor → stock units` mono
  readout, FRACTIONAL warn tag); **hold/release** in OperatorPanel (Hold/
  Release toggle, reason select, post-and-stay-open readout) + ledger
  `· N held` tag + single-selection "Hold / release" bulk action.

## What's memorable
- **The conversion rail**: as the operator types a purchase quantity the rail
  lights dim→mid and answers `× 12 → 300 ea` live; a non-whole result raises
  the amber FRACTIONAL tag (never blocks, never rounds — MG's rule made
  visible). Artifact: `tests/purchase-orders/receive-conversion.memorable.test.tsx` (3 RTL interaction tests).
- Hold mode's post-and-stay-open readout ("On hand 43 · Held 5" live region):
  `tests/inventory/operator-panel-hold.test.tsx`.

## Verification
- **Suite 803/803** (was 755 baseline) · `tsc --noEmit` clean · `biome check
  src` clean · `npm run check:craft` PASS.
- **`tests/inventory/kernel.test.ts` (18 tests, real local schema):** weighted
  moving average (2.00 → 2.50 on the second receipt), negative-stock receipt
  resets avg, in_transit floor, hold/release guards
  (insufficient_stock_to_hold / insufficient_held), reason required, hold +
  release as first-class ledger rows, post_stock_hold idempotency, ingestion
  door balance-neutrality + idempotency, **purchase-UoM end to end** (approve
  commits 25 case × 12 = 300 in_transit; receiving 2 cases lands 24 ea in the
  ledger + on_hand and 2.00/ea into the average; supplier_performance stays in
  cases; replay = no-op; convert orders 25 ea ÷ 12 ≈ 2.08 cases), onboarding
  seed's ledger row, and **the acceptance replay test: ledger replay equals
  stored balances (on_hand 44, on_hold 5) for a kernel-only product.**
- **Live-verified in the browser** (session dev server :3101, storeroom demo
  tenant): valuation strip renders (uncosted SKUs surfaced as "NO COST YET 6
  SKUs"); a kernel-posted costed receipt (25 @ $0.18) lit INVENTORY VALUE
  $7.74; hold of 5 posted through the UI ("On hand 43 · Held 5") → HELD VALUE
  $0.90 amber + ledger row tag "43 · 5 held"; **held stock stayed IN the
  $7.74 total (43 × 0.18) per MG's decision**; valuation CSV export returns
  correct rows (posted provenance, blanks not zeros for uncosted).

## Scope honesty
- Deferred by decision (kickoff doc): FIFO cost layers, landed cost, GL
  integration, three-way match.
- Ledger "Value" per-row column not rendered (strip + CSV + detail carry the
  story); trivial follow-up if MG wants it.
- Position helper consumes on_hold everywhere the ENGINE reads position;
  dashboards showing raw on_hand (Today strip) intentionally still show
  physical on-hand.
- `allocated` remains a wired-for placeholder (unchanged from Foundation).
- Prod migrations NOT applied; the 3 new files join the merge-gate checklist
  (verify prod SCHEMA, not the record, per the 07-08 lesson).

## Gate trail
- MG decisions locked: this doc + kickoff Status (2026-07-09).
- Codex review: `_reviews/2026-07-09_item2_w2_2_5.md` (see file).
- NEXT: MG walkthrough on the local bench (mg-store@local.test /
  StoreroomDemo1 has a costed, partially-held SKU ready), then merge gate on
  MG's go: apply 3 migrations to prod in order (w2_2_5a → w2_2_5b → w2_2_5c),
  re-probe schema, ff-merge, probe deploy.
