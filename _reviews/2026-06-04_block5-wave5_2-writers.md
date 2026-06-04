# Block 5 — CSV import (`CsvSourceAdapter`), Wave 5.2-writers

*Date: 2026-06-04. Phase 6, Tranche B. Built + live-verified, committed local. NOT yet Codex-gated or pushed.*

> **Scope:** Wave 5.1 shipped the **product** import end to end. This slice
> (5.2-writers) adds the **supplier** and **stock-movement** writers + the
> multi-kind `/import` lanes, so all three importable kinds are live. The
> heavier infra — Workflow DevKit durable `"use step"` path, cursor
> resumability, 10k<30s / 50k stress on Vercel Preview, Latin-1 re-decode,
> recurring-reupload UI, Server-Action-layer tests — is the separate
> **5.2-durable** slice (still tracked in `_reviews/_tickets.md`).

## What shipped

- **Multi-kind lanes** (`ImportWorkbench.tsx`): three ingestion lanes (Products /
  Suppliers / Sales & movements). Selecting a lane re-keys `ImportFlow` so the
  upload→map→preview state resets cleanly. The active lane carries the cobalt
  signal (border + a bottom rail that scales in) — the single Chain intent slot.
- **Supplier writer** (`commit.ts` → `writeSuppliers` → `import_suppliers` RPC):
  case-insensitive idempotent upsert on `(tenant_id, lower(name))`. Re-importing
  "Acme"/"acme" updates the same supplier, never duplicates. RPC is SECURITY
  INVOKER so RLS enforces the owner|manager|planner gate (same atomic-RPC pattern
  as Block 4's `link_supplier`).
- **Movement writer** (`writeStockMovements`): resolves SKU→product_id (unknown
  SKU = a per-row failure, not fatal), validates `occurred_at` (unreadable date =
  a per-row failure), and appends through the RLS client (owner|manager|warehouse).
  - **Auto-provisions a single "Primary" location** for greenfield tenants (no
    location is seeded at signup, and `stock_movements.location_id` is NOT NULL).
    Created via the admin client, since the warehouse role can write movements but
    not locations.
  - **Idempotent on a content-hash `source_ref`** (`sha1(sku|type|qty|occurredAt)`)
    + `ON CONFLICT DO NOTHING`, so a re-uploaded file is *skipped*, not
    double-posted. (Deviation from the ticket's literal "per-(run,row) key": a
    content hash makes a genuine re-upload idempotent even under a fresh
    idempotencyKey, which is what an operator re-uploading last month's sales
    actually wants. Tradeoff: two truly identical movements collapse to one — see
    Open items.)
- **Per-kind role gating** (`actions.ts`): products/suppliers = owner|manager|planner;
  movements = owner|manager|warehouse. Per-kind `revalidatePath` (suppliers→/suppliers).
- **Pure-layer fix:** the natural-key in-file de-dup now honors a `rowUnique`
  flag. Products/suppliers de-dup on their key (a repeat is a mistake); movements
  set `rowUnique:false` because a SKU recurs across every sale — true dupes
  collapse downstream on `source_ref`, not in mapRows. Supplier name also carries
  `caseFold` so "Acme"/"acme" collide in-file to match the DB's lower(name) key.

## Migration

`20260604120000_block5_import_writers.sql` (applied local via `supabase db reset`,
all 19 migrations clean):
- `suppliers (tenant_id, lower(name))` unique — case-insensitive supplier key.
- `stock_movements (tenant_id, source, source_ref, occurred_at)` unique — the
  movement dedup anchor (includes the partition key `occurred_at` as required).
- `import_suppliers(jsonb)` RPC — SECURITY INVOKER, `search_path=''`, granted to
  `authenticated`.

## Live verification (dev :3100, signed-in owner `wave52-verify@thechain.test`)

Drove all three lanes end to end by injecting real `File`s into the upload input
and clicking through map→preview→commit. The three-lane screenshot was viewed
inline during verification (Products lane lit cobalt) but the preview tool does
NOT persist screenshots to disk in this env, so DOM + DB facts below are the
evidence of record:

1. **Lanes render:** 3 `[role=tab]` (Products active), active lane's rail
   `transform: matrix(1,…)` = `scaleX(1)` (lit).
2. **Supplier import:** uploaded a 3-row supplier CSV → mapper drew **4** auto
   cobalt wires onto the *supplier* canonical fields (Name / Lead time (days) /
   Min order value / Status) → preview 3 rows → **"3 suppliers landed. Every row
   passed."**, "View suppliers" → `/suppliers`.
3. **Product import:** 2-row catalog → "2 products landed".
4. **Movement import:** 4-row sales CSV (2× WV-100, 1× WV-200, 1× GHOST-9) →
   **"3 sales & movements landed. 1 row was skipped and logged for review."**
5. **Re-upload (idempotency):** same movements file again → **"0 rows committed.
   3 rows were already on file and left untouched. 1 row was skipped…"**
6. **DB confirm (admin client):** suppliers = 3 (incl. "bayou supply" stored
   lowercase as imported), products = 2, stock_movements = **3 (unchanged after
   re-upload — no double-post)**, locations = **[Primary]** (exactly one, auto), 
   sync_failures = 1 `unknown_sku` (GHOST-9).

## Tests (+10 new; suite 169/169)

- `tests/import/writers-transform.test.ts` (pure) — supplier caseFold in-file
  dedup ("Acme"/"acme" → 1 payload + duplicate_key), supplier coercion + status
  default; movements not deduped on the recurring SKU; signed quantity +
  missing-required.
- `tests/import/commit-writers.test.ts` (integration, real JWT → RLS + RPC +
  admin) — supplier terms persisted; **case-insensitive idempotency** ("atlas
  foods" updates in place, no new row); in-file case-collision → duplicate_key;
  movement write + **auto Primary location** + unknown_sku/invalid_date failures;
  **re-upload dedup** (imported 0 / skipped 2 / no double-post).

typecheck / lint / craft guard clean.

## Open items (ticketed / for Codex)

- Two genuinely identical movements (same sku/type/qty/timestamp) collapse to one
  under the content-hash dedup. Acceptable for CSV bulk MVP; per-line distinctness
  is a 5.2-durable concern (idempotencyKey-scoped source_ref).
- `ensurePrimaryLocation` has a benign race (two concurrent first-imports could
  each create a Primary). Locations have no natural unique; low concern for the
  single-operator import path.
- Date coercion uses JS `new Date(occurredAt)` (handles ISO + common US formats).
  A strict per-locale parse + tests is a durable-slice item.
- Raw-px tokens in `import.module.css` (lanes) — stack-audit pass, craft guard
  passes today.
- All 5.2-durable items remain in `_reviews/_tickets.md`.
