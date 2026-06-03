# Block 4 — Master data: suppliers + lead times (checkpoint)

*Date: 2026-06-02. Phase 6, Tranche A. Built + live-verified, committed local. Codex deferred (runs over Blocks 3+4 together).*

> **Scope honesty (2026-06-03, after Codex round-2):** Block 4 is a **vertical slice, NOT FEATURES-complete.** Delivered: supplier roster/detail, create/edit/archive (open-PO guard), bidirectional product↔supplier links with atomic single-primary RPC, and the ReliabilityRibbon in its pending shape. **Still owed by the FEATURES.md contract (engine-blocked, tracked to Blocks 10/11):** lead-time history (median+p90), performance timeline, a lit ribbon with real OTIF/scorecard values, and forecast/policy recompute on lead-time edit (Block 8 engine). The ribbon today is a placeholder, not a delivered reliability feature. Do not read this file as "Block 4 done."

## What shipped

The supplier roster + the product↔supplier bridge that fills Block 3's empty
Suppliers panel.

- **Data layer** `lib/suppliers/queries.ts` + `transform.ts` (pure): `listSuppliers`
  (name, linked-product count, default lead time, rolling-30d OTIF), `getSupplierDetail`
  (contact, terms, linked products, reliability ribbon, scorecard), `listSupplierOptions`
  (link picker). RLS-scoped; mapping/OTIF-tone/ribbon logic is pure + unit-tested.
- **Mutations** `(app)/suppliers/actions.ts`: createSupplier / updateSupplier /
  archiveSupplier (role-gated; **archive rejects a supplier with open POs and names
  them** — durable guard, no POs exist yet) + product_suppliers link actions
  (linkSupplier, setPrimarySupplier, unlinkSupplier). Primary uniqueness:
  clear-then-set around the partial unique index.
- **Roster** `/suppliers` + AddSupplier disclosure. OTIF renders through `<StatNumber>`
  with semantic tone (flow/warn/stop), never cobalt.
- **Supplier detail** `/suppliers/[supplierId]` + SupplierActions (edit/archive).
- **Product↔supplier link UI** `SupplierLinks` on the SKU detail Suppliers panel:
  pick supplier + cost/lead/MOQ/primary → link; per-row make-primary / unlink. This
  populates Block 3's previously-empty panel; the supplier's "Products sourced"
  fills in reverse.

## Memorable element

**The reliability ribbon** (`_reviews/2026-06-02_feature_suppliers_memorable.png`):
the chain motif scaled to a row of delivery tiles — cobalt for on-time-in-full,
amber for short, stop-red for late — so you read a supplier's reputation at a
glance. Renders its full 8-tile shape even with zero history (dim hatched
placeholders + "No delivery history yet"), so a brand-new supplier shows the
ribbon it will earn. Cobalt here is the single Chain intent slot for the surface.
Component: `components/ReliabilityRibbon/`.

## Acceptance criteria

- [x] OTIF % through `<StatNumber>` with semantic flow/warn/stop tone (craft guard passes).
- [x] Multi-source SKUs render suppliers ranked by `is_primary` (sort in transform; unit-tested).
- [x] Archiving a supplier referenced by an open PO is rejected, naming the POs (guard implemented; unit-tested message).
- [x] Reliability ribbon (memorable) visible — artifact on disk.
- [ ] **Deferred (data-blocked):** editing a default lead time triggering the next forecast batch + `inventory_policy` recompute — the *write* lands now; the downstream recompute is Blocks 8/9.

## Verified live (local Supabase, signed-in path)

- Created supplier "Atchafalaya Distributing" (12d lead, $500 min); roster shows it.
- Supplier detail renders the reliability ribbon (pending) + terms/contact/catalog.
- Linked it to SKU CPR-2210 as PRIMARY (cost $2.45 / lead 12 / MOQ 25) → Block 3
  Suppliers panel filled; supplier "Products sourced" filled in reverse. Bidirectional.
- typecheck ✓ · lint ✓ (79 files, zero warnings) · craft guard ✓ · 127/127 tests ✓.
- Artifacts: `2026-06-02_feature_suppliers_memorable.png`, `2026-06-02_feature_suppliers_link.png`.

## Still deferred (data-blocked → Blocks 10/11)

- Live OTIF / scorecard values, lead-time history (median + p90), performance
  timeline, and a *lit* reliability ribbon all need `supplier_performance` +
  `supplier_scorecards`, which the PO lifecycle (Block 11) + scorecard rollup
  (Block 10) populate. Shapes are wired now; those surfaces fill with zero refactor.
- This also unblocks the Block 3 supplier filter + bulk supplier-reassignment.

## Gate status

Per the per-feature loop: build → screenshot → MG approve → `moretech-codex-review`
→ push. **MG plan: one Codex pass covering Blocks 3 + 4 together, after Block 4.**
Now at that point.
