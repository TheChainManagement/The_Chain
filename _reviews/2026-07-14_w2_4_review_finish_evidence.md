# W2-4 multi-location — review finish evidence (2026-07-14)

## Scope and gate

- Branch: `codex/w2-4-multi-location`.
- Contract: `docs/WAVE2_W2-4_MULTI_LOCATION_DESIGN.md`, signed off by MG.
- This evidence covers W2-4a-d build verification. Production migration, merge, and deployment
  remain behind a separate explicit MG authorization gate.

## Delivered contract

- Location lifecycle: create, rename, explicit primary, and guarded archive.
- URL-backed location scope: quiet single-location shell, `All locations` aggregate reads, and
  concrete active-location enforcement for physical writes.
- Scope propagation across inventory and operational surfaces, including forecast replay,
  movement history, eligibility, policy derivation, and per-SKU forecast detail.
- Transfer recommendations calculate destination need and source surplus without counting held,
  allocated, or safety stock as transferable.
- `execute_stock_transfer` is tenant/role gated, serializes idempotency keys, locks both balance
  rows deterministically, rejects unsafe quantities, and posts paired OUT/IN movements through
  `post_stock_movement` in one transaction.
- Transfer valuation passes the source cost layer into `post_stock_movement`; the kernel blends
  it into the destination under the same row lock as `transfer_in`. The transfer orchestrator
  never writes `inventory_levels` directly, and database contracts assert quantity/value
  conservation.

## Verification

- Clean local Supabase reset replayed every migration through
  `20260714150000_w2_4d_atomic_transfers.sql` successfully.
- Focused Vitest run: 7 files, 63 tests passed.
- Transfer database contracts cover matched movements, conservation, idempotent replay, role
  denial, same-location denial, excess-quantity denial, and absence of partial event writes.
- Full Vitest run after the kernel-only valuation amendment: 126 files, 897 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: 345 source files checked, passed.
- `npm run check:craft`: token discipline and trust hierarchy guard passed.

## Review disposition

W2-4a-d satisfy the signed-off build contract on the review branch. No production state was
changed. Final production readiness remains contingent on the complete suite and MG's explicit
merge/migration/deploy authorization.
