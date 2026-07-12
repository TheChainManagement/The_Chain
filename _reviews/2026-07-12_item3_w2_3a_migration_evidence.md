# Item 3 slice 1: W2-3a procurement schema — build evidence (2026-07-12)

Branch: `feature/item3-w2-3-procurement` (local, not pushed; awaiting MG review per the gate).
Scope: design doc `docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md` §10 slice 1 (signed off by MG
2026-07-12): enums + tables + RLS + audit + probes. No RPCs, no UI (slices 2-5).

## Schema (one migration, applied + tested locally)

`supabase/migrations/20260712120000_w2_3a_procurement_schema.sql`:

- **3 enums**: `rfq_status` (draft/sent/quoted/closed/canceled), `rfq_vendor_status`
  (pending/quoted/declined), `requisition_status`
  (draft/submitted/approved/rejected/converted/canceled).
- **6 tables**, house patterns throughout (tenant scoping, composite FKs,
  `set_updated_at` on headers, status indexes):
  - `rfqs` (header) + `rfq_lines` (qty in STOCK UoM, CHECK qty > 0)
  - `rfq_vendors` (one row per vendor, single OR multi per RFQ per §5.3)
  - `rfq_vendor_quotes` (vendor × line, costs in PURCHASE UoM, conversion factor
    SNAPSHOT at entry, CHECKs on cost/factor/lead/moq)
  - `requisitions` (header; `source_rfq_id` nullable for the direct path;
    requested_by / approved_by / decided_at carry the approval trail; thresholds
    bolt on in Wave 3 without a migration)
  - `requisition_lines` (chosen vendor per line; cost + UoM snapshots ride to the
    PO; `source_quote_line_no` lineage)
- `purchase_orders.requisition_id` (nullable, ON DELETE SET NULL back-reference).
- **RLS**: reads = tenant; writes = owner|manager|planner (the purchase_orders
  shape); deletes = owner. Applied via a loop, one policy set per table.
- **Audit**: the 5F dispatcher attached as `audit_<table>` on all 6 (the foundation
  discovery test enforces the naming).
- **Zero balance writes**: the migration touches no balance table and defines no
  balance-writing function. Enforced by probe (below).

## Probes (tests/procurement/schema.test.ts, 7 tests)

- **Zero-balance-writes contract (the headline)**: full document flow as a signed-in
  owner (RFQ → lines → vendors → sent → quote → requisition → lines → submitted);
  `inventory_levels` jsonb snapshot + `stock_movements` count are byte-identical
  before/after.
- Role matrix: planner CAN insert/update rfqs + requisitions; viewer insert raises
  row-level security; finance update affects 0 rows while in-tenant SELECT works.
- CHECKs reject qty 0 and factor 0.
- `purchase_orders.requisition_id` links and nulls on requisition delete; RFQ delete
  cascades lines (and vendors/quotes via FK chain) while requisitions survive with
  `source_rfq_id` nulled.

## Foundation coverage extended

- `tests/helpers/seed.ts` seeds all 6 new tables, so the auto-discovering
  cross-tenant RLS probe and the audit-trigger discovery test cover them genuinely
  (both green).

## Verification

- Suite: **816/816** (was 809; +7 procurement probes). tsc clean. biome clean.
- Local migration applied via `supabase migration up`.
- No UI in this slice: nothing to screenshot; the browser-visible surfaces arrive in
  slices 2-4 with their own walkthroughs.

## Flags for MG review

1. `rfq_lines.qty` is stock-UoM by design (§4); the quote grid presents purchase-UoM
   per vendor at entry. Confirm that reads right when you see the grid in slice 3.
2. Requisition self-approval is NOT blocked at the schema layer; the design puts it
   in the slice-4 RPC/action gate (same pattern as issue-out roles). Schema carries
   the columns to enforce and audit it.

## Next

Slice 2: RFQ bench (create from reorder selection + by hand, lines, vendor set,
export-for-manual-send document, status flow).
