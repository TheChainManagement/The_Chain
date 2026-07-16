# Wave 2 fast-follow cleanup evidence (2026-07-15)

Branch: `codex/w2-fast-follows`

Production and `main` are outside this branch's authority. No production changes are part of
this work.

## Slice 1: case-packed demo purchase order

- Extended `scripts/seed-storeroom-demo.mjs` with supplier `Gulf Bearing Supply`, a bearing
  supplier link carrying purchase UoM `case` and factor `12`, and one four-case PO identified by
  `DEMO-CASE-PO`.
- The seed calls `apply_po_approval` instead of imitating its balance work. The resulting PO is
  `sent`, its purchase-order line snapshots `case x 12`, and the inventory row carries 48 units
  in transit for the receive conversion walkthrough.
- Local fixture probe: ordered quantity 4, purchase UoM `case`, factor 12, in transit 48, supplier
  link unit cost 120 per case.
- Gate after the slice: clean `supabase db reset`; 127 Vitest files and 906 tests passed;
  `npx tsc --noEmit`, `npm run lint`, and `node scripts/check-craft.mjs` passed.

## Slice 2: direct requisition creation

- Added an owner, manager, and planner create surface on `/procurement`. A user chooses an active
  location and an existing active SKU-supplier link, then enters purchase quantity and unit cost.
- Added `create_direct_requisition` as a `SECURITY INVOKER`, documents-only RPC. It atomically
  creates the draft header and first line, keeps `source_rfq_id` and quote lineage null, snapshots
  the supplier link's purchase UoM and conversion factor, and calculates the header total.
- Contract probes verify the direct lineage, actor, total, conversion snapshot, cross-tenant RLS
  rejection, and byte-identical `inventory_levels` plus unchanged `stock_movements` count.
- Gate after the slice: clean `supabase db reset`; 127 Vitest files and 908 tests passed;
  `npx tsc --noEmit`, `npm run lint`, and `node scripts/check-craft.mjs` passed.
