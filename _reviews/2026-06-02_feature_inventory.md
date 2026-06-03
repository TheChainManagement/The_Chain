# Block 3 — Master data: products + SKUs (checkpoint 1)

*Date: 2026-06-02. Phase 6, Tranche A. Status: built + live-verified, NOT yet Codex-gated or pushed.*

> **Scope honesty (2026-06-03, after Codex round-2):** Block 3 is a **vertical slice, NOT FEATURES-complete.** Delivered: catalog ledger, search/status/supplier filters, SKU detail + data-backed first-stocked hop, create/edit/archive, bulk archive, 5k aggregate view + local directional bench. **Still owed by the FEATURES.md contract (engine-blocked, tracked to later blocks):** ABC-class + stockout-risk filters (Blocks 7/9), the real forecast→recommendation→PO policy chain on the SKU detail (Block 8 engine), bulk supplier-reassign/tag (ticketed), and the official Vercel Preview SLO bench (ticketed). Do not read this file as "Block 3 done."

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

## Checkpoint 2 (same day) — search/filter + edit/archive + tests

Committed slice (`338f557`), then finished the buildable remainder:

- **Search + status filter** — server-driven via `?q=&status=`. `InventoryControls`
  client island (debounced search, segmented Active/Discontinued/All) drives the
  URL; the Server Component re-queries. Search term is wildcard/injection-escaped
  in `sanitizeSearch` (strips PostgREST filter metacharacters). Verified: "copper"
  → CPR-2210 only; archived SKU drops from the default Active list.
- **Edit + archive UI** — `SkuActions` island in the detail header: Edit
  disclosure (prefilled → updateProduct) + Archive behind an inline confirm
  (→ soft `status='discontinued'`). Verified: name edit reflects in the title;
  archive flips the badge to Discontinued and removes it from the active ledger.
- **Pure transforms + unit tests** — extracted aggregation / classification-pick /
  search-escape / validation / write-error mapping into `lib/inventory/transform.ts`
  (no `server-only`); `tests/inventory/transform.test.ts` = 20 tests. Added the
  `@`→`src` alias to `vitest.config.ts` so tests can import app code. Suite now
  **102/102**.
- Artifacts added: `2026-06-02_feature_inventory_controls.png`.
- typecheck ✓ · lint ✓ (68 files) · craft guard ✓ · 102/102 tests ✓.

## Still deferred (genuinely data-blocked or out of scope)

- **Data-dependent filters** — supplier (needs Block 4), ABC class (Block 7),
  stockout-risk bucket (Block 9). The filter UI is built; these dimensions wire in
  when their data exists.
- **Bulk ops** — multi-select + bulk archive is buildable; bulk *tag* (no tag
  schema yet) and bulk *supplier reassignment* (Block 4) are blocked. Deferring
  the whole bulk bar to one coherent pass once Block 4 lands.
- **5k bench + aggregate view** — needs `seed-5k`; the read shape stays identical.

## Gate status

Per the per-feature loop: **build → screenshot → MG approve → `moretech-codex-review` → push.** Slice + finish committed locally (not pushed). Block 3 closes after the deferred items above land or are explicitly accepted; Codex gate precedes any push.
