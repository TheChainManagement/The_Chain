# Codex Review — blocks-3-4-inventory-suppliers
**Date:** 2026-06-02 19:20
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** blocks-3-4-inventory-suppliers
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- Inventory routes exist and are wired: `/inventory` lists RLS-scoped products via `src/lib/inventory/queries.ts:44-75`, renders on-hand through `<StatNumber>` in `src/app/(app)/inventory/page.tsx:84-86`, and has search/status URL controls in `src/app/(app)/inventory/InventoryControls.tsx:38-92`.
- SKU detail exists at `/inventory/[productId]`, returns `notFound()` when RLS returns no row (`src/app/(app)/inventory/[productId]/page.tsx:35-40`), renders position/classification/identity panels, and includes the claimed lifetime chain at `src/app/(app)/inventory/[productId]/page.tsx:83-140`.
- Product mutations exist: create/update/archive in `src/app/(app)/inventory/actions.ts:33-143`, with tenant id read from JWT for create and RLS relied on for update/archive.
- Supplier routes exist and are wired: `/suppliers` reads `listSuppliers()` from `src/lib/suppliers/queries.ts:30-52`, renders linked SKU count, default lead time, and OTIF through `<StatNumber>` in `src/app/(app)/suppliers/page.tsx:57-78`.
- Supplier detail exists at `/suppliers/[supplierId]`, renders terms/contact/products, and renders the reliability ribbon from `src/app/(app)/suppliers/[supplierId]/page.tsx:57-60`.
- Supplier mutations and product-supplier bridge exist: create/update/archive/link/set-primary/unlink in `src/app/(app)/suppliers/actions.ts:55-325`, with product supplier UI in `src/app/(app)/inventory/[productId]/SupplierLinks.tsx:85-231`.
- Evidence artifacts are present on disk: `_reviews/2026-06-02_feature_inventory.md`, `_reviews/2026-06-02_feature_inventory_memorable.png`, `_reviews/2026-06-02_feature_inventory_controls.png`, `_reviews/2026-06-02_feature_suppliers.md`, `_reviews/2026-06-02_feature_suppliers_memorable.png`, and `_reviews/2026-06-02_feature_suppliers_link.png`.
- Pure transform tests were added: `tests/inventory/transform.test.ts` and `tests/suppliers/transform.test.ts`. The craft guard passes locally: `npm run check:craft` returned `Craft guard PASS`.

## What wasn't done

- Inventory performance acceptance is not delivered. There is no `bench:inventory` script in `package.json:9-22`, no `seed-5k` harness, no p50/p95 report, and no EXPLAIN/index-usage artifact. The inventory evidence file explicitly defers this in `_reviews/2026-06-02_feature_inventory.md:23-25`.
- Inventory bulk operations are not delivered. The contract requires select rows + apply tag, archive, or supplier reassignment. The code has no multi-select or bulk Server Action; the evidence explicitly defers bulk ops in `_reviews/2026-06-02_feature_inventory.md:57-60`.
- Required inventory filters are incomplete. The contract requires filter by SKU substring, supplier, ABC class, and stockout-risk bucket. Only text search and status exist in `src/app/(app)/inventory/InventoryControls.tsx:74-91`; the evidence defers supplier/ABC/risk filters in `_reviews/2026-06-02_feature_inventory.md:54-56`.
- The SKU memorable element is only a shallow/static substitute for the specified lifecycle. `mapProductDetail()` hardcodes `firstStockedAt: null` at `src/lib/inventory/transform.ts:223`, and `LifetimeChain()` only derives “STOCKED” from that null field in `src/app/(app)/inventory/[productId]/page.tsx:83-121`. It does not read stock movements, forecasts, recommendations, or purchase orders, so it cannot show “first stocked → forecasted → reordered → received” with real timestamps.
- The detail page does not show the required “policy chain — forecast → recommendation → PO state” from the acceptance criteria. It shows ADDED/STOCKED/FORECASTED/REORDERED labels, but no policy state, recommendation state, or PO state is queried in `src/lib/inventory/queries.ts:81-92`.
- Supplier lead-time history and performance timeline are not delivered. The feature contract asks for median + p90 lead-time history and a performance timeline. The detail query pulls recent `supplier_performance` rows (`src/lib/suppliers/queries.ts:79-84`) but the page renders only a ribbon and aggregate terms; there is no median, p90, or timeline UI in `src/app/(app)/suppliers/[supplierId]/page.tsx:71-187`.
- Supplier forecast/policy recompute on default lead-time edit is not delivered. `updateSupplier()` only updates the supplier row and revalidates paths (`src/app/(app)/suppliers/actions.ts:133-154`). No workflow, forecast batch, or `inventory_policy` recompute is triggered. The evidence admits this is deferred in `_reviews/2026-06-02_feature_suppliers.md:43-44`.
- Server Action behavior is not tested. The added tests cover pure transforms only; there are no tests invoking `createProduct`, `updateProduct`, `archiveProduct`, `createSupplier`, `archiveSupplier`, `linkSupplier`, `setPrimarySupplier`, or `unlinkSupplier`.
- The advertised local test run could not be reproduced in this read-only review environment. `npm test -- --run tests/inventory/transform.test.ts tests/suppliers/transform.test.ts` failed before collection with `EPERM: operation not permitted, mkdir '/tmp/claude-501/.../ssr'`.

## What can be done better

- The primary-supplier swap is not atomic. `linkSupplier()` clears the existing primary at `src/app/(app)/suppliers/actions.ts:240-241` and inserts the new link at `src/app/(app)/suppliers/actions.ts:244-252`; `setPrimarySupplier()` clears at `src/app/(app)/suppliers/actions.ts:273-274` and then updates at `src/app/(app)/suppliers/actions.ts:276-282`. If the second write fails or two requests race, the SKU can be left with no primary. This belongs in a single RPC/transaction.
- Product-supplier validation is too weak for operational master data. `validateLinkInput()` only checks that supplied numeric strings are finite (`src/lib/suppliers/transform.ts:264-277`); blanks, negative unit cost, negative lead time, decimal lead time, and negative MOQ can pass. Then `parseIntOrNull()` truncates decimals at `src/app/(app)/suppliers/actions.ts:37-44`. That is not production-grade lead-time/MOQ handling.
- Token discipline is claimed in comments but violated all over the new CSS modules. Examples: hardcoded grid widths in `src/app/(app)/inventory/inventory.module.css:114`, hardcoded form width at `src/app/(app)/inventory/inventory.module.css:272`, hardcoded supplier grid at `src/app/(app)/suppliers/suppliers.module.css:5`, hardcoded ribbon gap/height/delay at `src/components/ReliabilityRibbon/ReliabilityRibbon.module.css:11-22`. MASTER_PROMPT says spacing, motion timing, and font sizing come from tokens.
- The feature checkpoint was batched despite the project’s own per-feature loop. `_reviews/2026-06-01_wave1_build_plan.md:5` says “Per-feature loop, never batched,” but `_reviews/2026-06-02_feature_suppliers.md:64-65` says one Codex pass covers Blocks 3 + 4 together. That weakens the Phase 6 gate.
- Search sanitization is crude. `sanitizeSearch()` strips many characters in `src/lib/inventory/transform.ts:235-244`, which prevents obvious PostgREST grammar injection, but it also silently changes user queries. Better is a structured PostgREST escape helper with tests against actual query behavior.
- Error handling is inconsistent. `listInventory()` and `getProductDetail()` throw raw `Error(...)` strings at `src/lib/inventory/queries.ts:69-72` and `src/lib/inventory/queries.ts:94-96`; no route-level `error.tsx` surfaces are added for these feature pages.

## What was missed

- The inventory feature is not done against `FEATURES.md`. The contract includes 5k performance, index-plan inspection, full filters, bulk operations, cross-tenant probe, and a real policy/lifetime chain. This tranche shipped a useful vertical slice, not the full Block 3 feature.
- The supplier feature is not done against `FEATURES.md`. The contract includes lead-time history, performance timeline, CRUD/product-supplier management, and recompute behavior on lead-time changes. This tranche shipped roster/detail/linking plus a pending-state ribbon, not the full Block 4 feature.
- The memorable artifacts exist, but the inventory one is not behaviorally backed by the data model. A screenshot of a static chain does not satisfy the requirement that the chain tell the SKU’s actual story.
- Acceptance evidence leans on manual local verification and screenshots. There is no Playwright interaction test for the inventory chain, supplier ribbon, create/edit/archive flows, link supplier flow, cross-tenant product detail 404, or supplier archive guard.
- The supplier archive guard is only partially meaningful today. It queries open POs in `src/app/(app)/suppliers/actions.ts:170-175`, but there is no integration test proving RLS, tenant scoping, and the open-PO message work together against real rows.
- The review should block full feature closure. These are buildable slices with evidence, not completed Phase 6 feature blocks.

## Decisions (captured 2026-06-02, MG)

### Primary-supplier swap not atomic
- **Decision:** Fix now (RPC).
- **Action:** Add a `set_primary_supplier` Postgres RPC (migration) doing clear+set in one transaction; swap `linkSupplier` + `setPrimarySupplier` call sites onto it.

### Link validation too weak + lifetime chain static
- **Decision:** Do both now.
- **Action:** Harden `validateLinkInput` (reject negative + non-integer lead/MOQ, negative cost). Wire `firstStockedAt` from `stock_movements` so the SKU lifetime chain is data-backed.

### No action/RLS integration tests + minor robustness
- **Decision:** Add tests now.
- **Action:** Integration tests for product + supplier mutations, archive guards, single-primary invariant, and cross-tenant RLS via the auth-postgrest harness. Add route `error.tsx`, replace raw `Error` throws where surfaced, tidy raw-px CSS where tokens exist.

### Deferred full-block features (5k bench, bulk, filters, lead-time history, perf timeline, recompute)
- **Decision:** Complete 3+4 fully first (before Block 5).
- **Action:** Build a seed harness (`npm run seed`, incl. seed-5k) to make the data-backed surfaces real, then build: bulk ops, supplier/ABC/stockout filters, real policy chain (forecast→recommendation→PO), lead-time history (median+p90), performance timeline, lit reliability ribbon, OTIF, and the 5k bench (aggregate view + `bench:inventory` + index-plan). NOTE: "editing lead time triggers the forecast batch" is partially engine-blocked — the forecast batch is Block 8; this pass implements the lead-time write + an `inventory_policy` staleness marker, full recompute when Block 8 lands.

### Push
- **Decision:** Deferred — Block 4 stays local until the above lands and re-review/MG approval.
