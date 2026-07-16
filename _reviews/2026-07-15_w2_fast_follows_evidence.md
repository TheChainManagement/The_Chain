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
