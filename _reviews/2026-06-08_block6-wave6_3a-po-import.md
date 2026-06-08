# Block 6 Wave 6.3-A — QBO Purchase Order import + supplier contact enrichment

**Date:** 2026-06-08
**Phase:** 6 (Features), Block 6 (QBO), Wave 6.3-A
**Skills invoked:** none new. Design system is the locked DESIGN_DIRECTION.md + MASTER_PROMPT.md from the project's design phase; this wave reuses the established component vocabulary (ChainLink, StatNumber, Panel, PageHeader) exactly as prior Block 5/6 waves did. No build-beautiful re-run (per-wave features inherit the locked design, same as Waves 5.x/6.1/6.2).
**Artifacts reviewed against:** FEATURES.md (Block 6 / PO write-into-purchase_orders), MASTER_PROMPT.md, SYSTEM_DESIGN.md (§Suppliers and procurement).

## What was built

Two self-contained slices on top of Wave 6.2b's durable QBO initial sync.

### Slice 1 — QBO purchase orders import into the catalog

Wave 6.2b wrote products/suppliers/movements but only COUNTED POs (`drainKind('purchase_order').length`). This wave makes POs a real write phase.

- **Migration** `20260608120000_block6_po_import.sql`: full unique index `purchase_orders (tenant_id, external_po_id)` (Postgres treats NULLs as distinct, so it enforces one row per QBO PO while leaving unlimited null-external system POs for the reorder engine; supabase-js can infer it via onConflict, a partial index could not). Plus an `external_reference` column for the operator-facing DocNumber ("PO-1001"), separate from the entity id used for idempotency.
- **Canonical + map**: added `reference` (optional) to `purchaseOrderAttributes`; `mapPurchaseOrders` now carries `po.DocNumber`.
- **sync-core**: new `purchase_order` phase (last, after products + suppliers). Resolves `supplier_id` via `suppliers.external_ids->>'qbo'` and each line's `product_id` via `products.external_ids->>'qbo'` (same indirection the movement phase uses). Upserts the header on `(tenant_id, external_po_id)`; upserts lines on `(po_id, line_no)` with a tail-prune so a shrunk PO converges. A PO whose lines are all non-inventory is skipped (not an error), like a non-inventory movement. `recommended_by='external'`, `sync_status='in_sync'`. Counts (`ordered`/`inTransit`) now derive from the written phase, not a read-only drain. `ConnectPanel.phaseToStage` maps the trailing `purchase_order` phase to fully-lit so the connect reveal (CATALOG→SUPPLIERS→SALES) is unchanged.
- **UI — `/purchase-orders` cockpit**: metric strip (Open / Committed / Total), a featured order rendered as the full igniting cobalt `ChainLink` chain (SUPPLIER→ORDERED→IN TRANSIT→RECEIVED), and a ledger with a compact `OrderTrack` diamond progress track per row. Nav entry added.
- **UI — supplier-detail PO panel**: each supplier's POs with the same `OrderTrack`.
- **Pure logic** `lib/purchase-orders/transform.ts`: row mapping, `orderFrontier`/`buildOrderChain` stage logic, status semantics, open/committed aggregates. 20 unit tests.

### Slice 2 — supplier contact enrichment

`mapVendors` already produced `contact {email, phone, web}` but `syncSuppliers` dropped it. Now it persists `contact` (merged — `{...prior, ...qbo}` so QBO wins per field but an operator-entered value QBO lacks survives; written unconditionally because the column is NOT NULL and `merged` ⊇ prior can only be empty when both are) + `qbo_vendor_id`. The supplier Contact panel that read "No contact details yet" now shows email/phone/QBO vendor.

## Verification

- **Integration test** (real local Supabase, `tests/qbo/sync-core.test.ts`): 2 POs / 3 lines imported, supplier+product refs resolved, status mapped (`sent`/`closed`), `recommended_by='external'`, idempotent re-run = zero dupes. Supplier enriched with `contact.email`/`contact.phone`/`qbo_vendor_id='56'`.
- **Memorable artifact** (`tests/purchase-orders/order-chain.memorable.test.tsx`): the hero OrderChain ignites done/done/active/pending for an open PO, all-done for a received PO; cobalt connectors on done links; OrderTrack aria progress label.
- **Live browser** (seeded fixture tenant, `localhost:3100`): cockpit OPEN 1 / COMMITTED $840 / TOTAL 2, PO-1001 chain lit through IN TRANSIT (due May 28), PO-1002 closed (4/4); supplier panel shows PO-1001 $840 OPEN; Contact panel shows email/phone/QBO vendor 56. No console errors (preview_console_logs level=error returned none). **Evidence of record = the a11y snapshots (preview_snapshot) + the DB facts below**, NOT on-disk PNGs: `preview_screenshot` returns the image inline to the operator but does NOT write the file to disk in this environment (known gotcha, memory `project_the_chain`), so the screenshots were reviewed inline only and are intentionally not cited as repo artifacts.
- **DB facts** (`docker exec ... psql`): `purchase_orders` = PO-1001 (Atchafalaya, sent, $840.00, 2 lines, external) + PO-1002 (Bayou, closed, $1150.00, 1 line, external); `suppliers` Atchafalaya `qbo_vendor_id=56`, `contact.email=orders@atchafalaya-dist.example`, `contact.phone=(985) 555-0142`.
- **271/271 tests**, typecheck / lint / craft clean.

## Codex round-1 (`_reviews/2026-06-08_block6_wave6_3a_po_import.md`, gpt-5.4 full)

Fixed in-slice: (1) partial-PO transparency — unmapped lines of an IMPORTED PO now record to `sync_failures` (`unmapped_po_line`, not counted in headline errors) so a partial PO is never a silent truncation; (2) shrunk-PO convergence now PROVEN — `tests/qbo/sync-core.test.ts` inserts a phantom line and asserts the tail-prune removes it on re-sync; (3) this evidence file's screenshot claim corrected (above); (4) FEATURES.md Block 6 updated to reflect PO import landed.
Ticketed / wave-scoped (in `_reviews/_tickets.md`): incremental sync + webhook + cron + conflict UI + PO write-BACK (own session; write-back blocked on the Blocks 7-9 reorder engine that generates POs); Playwright 3-state connect-screen artifact (infra-blocked); action-layer tests for `runQboInitialSync`/`getQboSyncProgress`. The checkpoint is a WAVE checkpoint (6.3-A), not Block-6-complete; skills=none is correct for a feature wave inheriting the locked design.

## Deferred (not this slice)

- PO write-BACK (our generated POs → QBO via adapter `push()`): nothing to push until the reorder engine (Blocks 7-9) generates POs.
- Incremental sync + conflict policy + `/flow/sync-conflicts` + cron + webhook: own session.
- No PO detail route yet (cockpit rows link to the supplier); fine for v1.
