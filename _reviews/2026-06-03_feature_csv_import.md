# Block 5 — CSV import (`CsvSourceAdapter`), Wave 5.1

*Date: 2026-06-03. Phase 6, Tranche B. Built + live-verified, committed local. NOT yet Codex-gated or pushed.*

> **Scope honesty:** Wave 5.1 ships the **product** import end to end. The adapter
> is wired for all three importable kinds (product / supplier / stock_movement) and
> the column-mapper + commit core are kind-driven, so the remaining UI is config,
> not a rebuild. Wave 5.2 (tracked) adds: supplier + sales/movement writers, the
> recurring re-upload flow, the Workflow DevKit `"use step"` durable/resumable
> path + 10k<30s / 50k stress on Vercel Preview, and Latin-1 re-decoding. This file
> is NOT "Block 5 done."

## What shipped (the product vertical)

- **`CsvSourceAdapter`** (`src/lib/import/csv-adapter.ts`) conforms to the Foundation
  `SourceAdapter` contract (`source: 'csv'`, read-only capabilities). `pull(kind)`
  parses + maps + validates and returns canonical payloads with per-row errors;
  unsupported kinds throw `FatalError`; `push()` throws `FatalError` (read-only).
- **Pure import lib** (`src/lib/import/`):
  - `field-specs.ts` — per-kind canonical field descriptors (drives the mapper UI
    AND coercion). Product/supplier/movement defined.
  - `parse.ts` — papaparse wrapper, BOM-safe, header mode, Excel dialects.
  - `mapping.ts` — `autoMap` default-from-name heuristic (one header → one field),
    `missingRequired`, `unmappedHeaders`.
  - `transform.ts` — row → `CanonicalPayload` with per-type coercion + canonical
    Zod validation; errors carry the CSV row number; valid rows survive bad rows.
- **Commit core** (`src/lib/import/commit.ts`, server-only) — the reusable engine a
  Wave 5.2 workflow step will wrap. Products upsert through the caller's RLS client
  (tenant + owner/manager/planner enforced); `sync_runs`/`sync_failures` write
  through the service-role admin client (`src/lib/supabase/admin.ts`) because those
  are "system mutate" in the RLS matrix. Idempotent on `(tenant_id, sku)`.
- **`/import` UI** (`src/app/(app)/import/`): server page + `ImportFlow` state machine
  (upload → map → preview → done), `UploadZone` (drag-drop), `ColumnMapper` (the
  memorable element), `PreviewPane` (dry run), `actions.ts` (role-gated commit).
- Nav: "Import" added to the bench LeftRail.

## What's memorable (the pegboard)

The column-mapping screen: CSV columns on the left with first-row samples, The
Chain's canonical fields on the right (required marked), wired by **cobalt connector
lines**. Auto-mapped columns open pre-wired; drag a left port to a right field (or
click one then the other) to rewire; `×` to unwire. Cobalt is the single Chain
intent slot on the surface.

## Live verification (dev server :3100, signed-in owner)

Drove a 6-column / 3-row CSV (`catalog.csv`) end to end. Screenshots were viewed
inline during verification but did NOT persist to disk (the preview tool returns
the image inline; the file write to `_reviews/*.png` did not land in this env). The
on-disk evidence of record is the DOM/DB facts below.

1. **Upload → Map:** mapper rendered with **4 cobalt connector wires** auto-drawn
   (Item Number→SKU, Product Name→Name, UOM→Unit of measure, Status→Status), confirmed
   by `document.querySelectorAll('svg path').length === 4`. Description left unmapped;
   Category/Color shown as available left ports.
2. **Preview:** dry-run stats (3 ready / 0 skipped / 3 in file via StatNumber) +
   canonical-mapped table (`tbody tr` count === 3).
3. **Commit (live, client → Server Action → DB):** rendered "3 products landed. Every
   row passed."
4. **DB confirm (psql):** products RBH-4471 / CPR-2210 / GSK-0098 present with correct
   status (GSK-0098 discontinued) + `external_ids {csv: sku}`; `sync_run` completed
   with `entities_processed {product: 3}`. No console errors (`preview_console_logs`
   level=error returned none).

## Tests (21 new; suite 155/155)

- `tests/import/mapping.test.ts` — normalizeHeader, autoMap heuristic (one-header-
  one-field), missing/unmapped, coercion (number/integer/enum + status default),
  schema rejection, mapRows valid-survive-bad with row numbers.
- `tests/import/adapter.test.ts` — `CsvSourceAdapter` assignable to `SourceAdapter`
  (the compile acceptance), capabilities, pull payloads, per-row errors, BOM strip,
  unsupported-kind + push `FatalError`.
- `tests/import/commit.test.ts` (integration, real JWT → RLS + admin) — **idempotency:
  re-import does not duplicate; re-import updates an existing SKU; bad row lands in
  sync_failures; sync_run records completed + product count.**
- `server-only` aliased to a stub in `vitest.config.ts` so the commit core is
  testable in node.

typecheck / lint(81→) / craft guard clean.

## Deferred to Wave 5.2 (tracked)
Supplier + stock_movement writers · recurring re-upload · Workflow DevKit durable
step + 10k<30s / 50k stress on Vercel Preview · Latin-1 re-decode · Server Action
layer tests for the import action.
