
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

## Block 5 Wave 5.2 + Codex tickets (2026-06-03)
- **Supplier + sales/movement import writers** — the adapter + commit core are kind-driven; add the `/import` tabs + per-kind DB writers (movements normalize into `stock_movements`, signed quantity, occurred_at preserved, source='csv').
- **Honor idempotencyKey on append-only writes** — stock_movements are not natural-key-deduped like products; the import must dedupe re-uploaded movements by idempotencyKey (e.g. a per-(run,row) source_ref unique key). Products stay natural-key idempotent.
- **Workflow DevKit durable path** — validation inside `"use step"`, cursor resumability via `sync_runs.cursor`, progress stream for large files, recurring re-upload. Wrap the existing `runCsvImport` core in a workflow (no rewrite of the core).
- **Performance: 10k<30s p95 + 50k no-OOM stress** on the Vercel Preview harness; streaming parse above a row threshold. Persist the bench artifact.
- **Encoding: Latin-1** — the browser `FileReader.readAsText` assumes UTF-8 and will misdecode Latin-1 before the server sees bytes. Read as ArrayBuffer + detect/decode (UTF-8 / BOM / Latin-1) on the server; add encoding tests.
- **Raw-px CSS → tokens** in `src/app/(app)/import/import.module.css` (300px, 8rem, 36px, 26ch, etc.) during the stack-audit pass. Craft guard passes today.
- **Server Action layer test** for `runImport` (role-gating, revalidate, error mapping) through the action boundary.
