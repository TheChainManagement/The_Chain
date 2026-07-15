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
- Final full Vitest run after the live walkthrough and selector interaction guard: 126 files,
  898 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: 345 source files checked, passed.
- `npm run check:craft`: token discipline and trust hierarchy guard passed.

## Live local walkthrough (2026-07-15)

- Created a throwaway authenticated tenant through the real signup/onboarding route and created
  `Main Warehouse` plus `North Warehouse` through `/settings/locations` without database access.
- Confirmed the selector stays suppressed at one location, appears at two, presents `All
  locations`, marks the primary, and renders a concrete URL scope across bench navigation.
- Added an interaction regression asserting a concrete selector change calls
  `router.replace('/today?location=l2')`. The browser driver's native-select helper changes the
  DOM value without dispatching React's handler; the component-level interaction test covers the
  event contract, while the real scoped URL verified the server/client rendered state.
- Seeded one local-only demonstration SKU through `post_stock_movement`. `/transfers` displayed
  source surplus 90, destination need 45, and suggested move 45.
- Executed the transfer through the real Server Action/RPC. The recommendation resolved to the
  empty safe-transfer state; a database read confirmed Main 55, North 50, identical unit costs,
  and matched `transfer_out -45` / `transfer_in +45` rows sharing one transfer UUID.
- Opened `/inventory?location=<north>` and confirmed the selector, all navigation links, SKU
  detail link, inventory quantity 50, and valuation $500 remained scoped to North Warehouse.

## Review disposition

W2-4a-d satisfy the signed-off build contract on the review branch. No production state was
changed. Final production readiness remains contingent on the complete suite and MG's explicit
merge/migration/deploy authorization.
