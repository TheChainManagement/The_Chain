# W3 checkpoint fix round 4 — Claude re-check verdict

Date: 2026-07-23
Branch: `codex/w3-role-spine`
Production remains: `362137d` (untouched)

## VERDICT: GO — FULL GREEN. Fix rounds are CLOSED.

Round 4 was the expected closing round and it closed. Independent re-check (nothing
taken from Codex's report):

- Clean `supabase db reset` replays every migration through the amended
  `20260722120000_w3_checkpoint_fix_round1.sql` (rounds 1-4 in one file, per protocol).
- `npx vitest run`: **140 files / 992 tests / 992 passed — ZERO red.** First fully
  green suite since the original W3 checkpoint.
- `npm run typecheck`: clean. `npm run lint` (biome): clean, 366 files.
  `npm run check:craft`: PASS. `npm run build`: PASS.

## Fix-by-fix verification

- **R4-F1 (PRODUCT — reorder UoM pair) FIXED.** Both loops in
  `convert_recommendations_to_requisition` now normalize blank/null
  `product_suppliers.purchase_uom` to null and null the snapshot factor with it, so the
  inserted `requisition_lines` pair is either (uom, factor) or (null, null) — never the
  (null, 1) pair that violated `requisition_lines_uom_factor_pair_check`. Arithmetic uses
  `coalesce(v_factor, 1)` so stock-unit math is unchanged. Real-DB probe proves a
  UoM-less supplier link converts: null/null snapshot, qty 100 stock units, unit cost 5,
  total 500, no PO under default policy. Reorder conversion for UoM-less tenants is alive.
- **R4-F2 (TEST) FIXED.** B2 happy-path probe keeps the authenticated direct-PO
  rejection (`approved_requisition_required`), then applies the valid converted PO under
  the superuser/service-role seam exactly as prod does, and now also asserts the
  `in_transit` delta of exactly +1. No RLS relaxed.
- **R4-F3 (TEST) FIXED.** Cross-tenant `create_direct_requisition` now expects the
  stricter `requisition_creation_forbidden` (B1 tenant pin fires first), and a separate
  probe retains the own-tenant + foreign-location `active_location_not_found` coverage
  that the old assertion was accidentally providing.

## Invariants re-verified

- Zero-balance-writes: round-4 diff touches only requisition document inserts. The one
  `inventory_levels.in_transit` write in the migration file lives in `apply_po_approval`,
  the pre-existing sanctioned seam, untouched by this round (verified by diff scan).
- No RLS policy changes, no new migration files (amend-in-place per protocol), no
  push/merge/prod action performed by Codex. Prod is still `362137d`.

## NEXT — the EIGHT-migration MG merge gate (MG-only)

Apply to prod `hdpivaufoqokeuzgftsj` IN ORDER via Supabase MCP, then re-probe schema +
advisor, ff-merge `codex/w3-role-spine` to main, verify deploy:

1. `20260717120000` w3_0 access spine
2. `20260717133000` w3_1 provisional accounts
3. `20260718120000` w3_2 tenant switch
4. `20260718123000` w3_2 review hardening
5. `20260718130000` w3_3 location assignments
6. `20260718140000` w3_4 primary-location atomicity
7. `20260720120000` w3_5 approval policy
8. `20260722120000` w3 checkpoint fixes rounds 1-4 (final amended file)

Per the staged-testing rule, MG live-tests once at wave close: a TEST_KIT should be
prepared before the gate runs (fresh seeded tenants were wiped by db resets).
