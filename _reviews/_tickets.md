
## Block 3 bulk ops — remaining (2026-06-03)
Delivered: row selection + select-all + bulk archive (RLS-gated). From the Codex
"bulk operations not delivered" finding.
Deferred:
- **Bulk supplier reassignment** — needs a bulk_set_primary_supplier(uuid[], uuid)
  RPC (upsert link + set primary per product) + a supplier picker in the bulk bar.
  Real-data ready (suppliers exist); cut for scope on 2026-06-03.
- **Bulk tag** — no read surface for tags yet (attributes.tags is unrendered).
  Build alongside a tag column/chip UI so it isn't write-only.

## Codex round-2 tickets (2026-06-03)
- **Raw-px CSS → tokens (stack-audit pass).** Hardcoded grid widths/heights/font-sizes/animation delays in `src/app/(app)/inventory/inventory.module.css` (~L113), `src/app/(app)/suppliers/suppliers.module.css` (~L4), `src/components/ReliabilityRibbon/ReliabilityRibbon.module.css` (~L9). Craft guard passes today; tighten during the post-Path-3 stack audit / typography migration.
- **Official 5k bench on the Vercel Preview harness.** MASTER_PROMPT requires the Preview-harness SLO number, not the local directional run (p50 18.5ms local). Run once a seeded Preview deploy exists. Also: index `product_classifications` to kill the seq scan once Block 7 populates it.
- **Server Action layer integration tests.** `tests/inventory/mutations.test.ts` covers the RPC/RLS path. Add coverage through the action wrappers: createProduct, updateProduct, archiveProduct, createSupplier, updateSupplier, archiveSupplier, unlinkSupplier (validation, role-gating, revalidate, open-PO archive guard end to end).
