# Block 3 — Master data: products + SKUs (checkpoint 1)

*Date: 2026-06-02. Phase 6, Tranche A. Status: built + live-verified, NOT yet Codex-gated or pushed.*

## What shipped this checkpoint (vertical slice)

The catalog's first real surface — create a SKU, see it in the ledger, open its bench.

- **Data layer** `src/lib/inventory/queries.ts` — `listInventory` (products + summed inventory_levels + tenant-wide classification) and `getProductDetail` (per-location position, suppliers, classification, lifecycle). RLS-scoped via the authenticated client; helpers never take a tenant_id.
- **Mutations** `src/app/(app)/inventory/actions.ts` — `createProduct` / `updateProduct` / `archiveProduct` (soft `status='discontinued'`). tenant_id from the verified JWT claim; RLS `has_role('owner','manager','planner')` is the real gate. Friendly mapping for unique-SKU + RLS-denied.
- **List** `src/app/(app)/inventory/page.tsx` — Server Component cockpit ledger (SKU mono, product + UoM, on-hand `<StatNumber>`, ABC·XYZ tag, status). Hairline rows, no cards, full-row link, empty state. `AddSku` client disclosure island wired to `createProduct`.
- **Detail** `src/app/(app)/inventory/[productId]/page.tsx` — memorable lifetime chain + position / suppliers / classification / identity panels, each with on-direction empty states. `notFound()` on cross-tenant/missing id.

## Memorable element

**The SKU lifetime chain** (`_reviews/2026-06-02_feature_inventory_memorable.png`): the PO-chain motif scaled down to one SKU's story — ADDED (ignited cobalt, live edge) → STOCKED → FORECASTED → REORDERED. You read where a SKU is in its life at a glance. The cobalt ignite is the single Chain intent slot on the page.

## Acceptance criteria

- [x] On-hand renders through `<StatNumber>` (craft guard passes — no inline number rendering).
- [x] No card boxes; hairline dividers only.
- [x] Cross-tenant / missing productId → 404 (verified live with a bogus UUID; RLS returns no row → `notFound()`).
- [x] Detail shows the SKU's chain visualization at the top of the page.
- [ ] **Deferred (needs seed-5k):** p50<600ms / p95<1.2s for 5,000 SKUs + index-usage check. Index-optimized aggregate moves to a `security_invoker` view once `npm run seed` / seed-5k exists; the read shape stays identical. Logged, not silently dropped.

## Verified live (local Supabase, signed-in path)

- Created 3 organic SKUs (RBH-4471, CPR-2210, PVC-0805) through the UI; ledger renders + sorts.
- SKU detail renders the lifetime chain + empty panels; console clean.
- typecheck ✓ · lint ✓ (65 files) · craft guard ✓ · 82/82 tests ✓.
- Artifacts: `2026-06-02_feature_inventory_list.png`, `2026-06-02_feature_inventory_memorable.png`.

## Not in this checkpoint (Block 3 remaining, before block close)

- Search + filter (SKU substring, supplier, ABC class, stockout bucket) + bulk ops (tag / archive / supplier reassign).
- Edit + archive UI on the detail page (server actions exist; no UI yet).
- Block 3 tests: memorable Playwright/Vitest interaction test + cross-tenant probe test on disk (UI-verified now; codify before push).
- 5k bench + the aggregate view.

## Gate status

Per the per-feature loop: **build → screenshot → MG approve → `moretech-codex-review` → push.** Now at MG-approve. Codex gate + the remaining Block 3 items precede any push.
