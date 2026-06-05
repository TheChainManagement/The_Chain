
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

## Block 5 Wave 5.2-writers — Codex round-1 tickets (2026-06-04)
Review: `_reviews/2026-06-04_block5_wave5_2_writers.md`. Fixed in-slice: action-boundary
try/catch for infra throws (ensureCsvConnection/ensurePrimaryLocation); lanes memorable
RTL artifact (`tests/import/lanes.memorable.test.tsx`). Deferred:
- **Writer-stage failures lose CSV row numbers.** Adapter-stage (coercion/schema) errors
  carry the row number, but writer-stage errors (unknown_sku, invalid_date for movements)
  key by SKU, so `summary.failures.row` degrades to 0 and `sync_failures.external_ref`
  stores the SKU not the row. Thread row provenance through the adapter/payload. → 5.2-durable.
- **occurred_at strict parsing + TZ.** The movement writer reparses via `new Date()` →
  `toISOString()`, which normalizes a date-only/TZ-bearing value to a UTC instant rather
  than preserving source fidelity. Replace with a strict per-format parse + explicit TZ
  handling; add date/encoding tests. → 5.2-durable (pairs with Latin-1 decode).
- **Server Action layer test for `runImport`** — role-gating, revalidate, per-kind dispatch,
  error mapping through the action boundary. (Standing from 5.1; reaffirmed.) → 5.2-durable.
- **Raw-px tokens in `import.module.css`** now include the lane geometry (720px, 3px, 15px,
  12px) on top of the existing 5.1 px. → stack-audit pass.

## Block 5 Wave 5.2-durable — open items (2026-06-04)
Shipped: threshold-gated durable importWorkflow + admin write core + live progress bar.
Evidence `_reviews/2026-06-04_block5-wave5_2-durable.md`. Deferred:
- **Terminal-failure propagation.** A durable step that ultimately fails (after DevKit
  retries) leaves sync_run status='running'; the client poll cap hands off softly but
  the run isn't marked 'failed'. Add RetryableError/FatalError classification in the
  step + a failed-state write so the poller can show a real failure.
- **Large CSV input → Blob.** The whole csvText is passed as the workflow input
  (persisted with the run). Stage to Vercel Blob + read ranges for the 50k path
  instead of inlining megabytes of run state.
- **Official perf bench on Vercel Preview.** 10k<30s p95 + 50k no-OOM must run on a
  seeded Preview deploy (Local World is synchronous, so dev timing isn't the SLO).
- Still open from earlier 5.2 tickets: true streaming parse, Latin-1/Windows-1252
  decode, recurring re-upload UI, writer-stage row provenance, runImport action-layer test.

## Block 5 Wave 5.2-durable — Codex round-1 (2026-06-04)
Review `_reviews/2026-06-04_block5_wave5_2_durable.md`. Fixed in-slice: durable-completion
revalidatePath; `failed` progress state surfaced to the client. Deferred:
- **Mark sync_run 'failed' on terminal step failure.** Needs RetryableError/FatalError
  classification in the step so transient retries don't flash a false failure; only a
  FatalError (or exhausted retries) writes status='failed'. The client already handles it.
- **Workflow-boundary crash-resume integration test** — drive importWorkflow through a
  deliberate process.exit mid-run and assert same final state (not just the core).
- **Playwright memorable-element artifact harness** — persistable visible-craft proof
  (the preview screenshot tool doesn't persist to disk in this env).
- Raw px (6px/12px) in the progress styles → stack-audit (with the existing import.module.css px ticket).

## ✅ RESOLVED — Block 5 import ticket-cleanup sweep (2026-06-04)
Knocked out the recurring self-contained Codex findings so they stop boomeranging:
- **Writer-stage row provenance** — `CanonicalPayload.sourceRow` + `PullResultError.row`
  thread the CSV row number; movement unknown_sku/invalid_date failures and
  `summary.failures.row` now carry the real row. (both sync + durable paths)
- **runImport Server Action-layer test** — `tests/import/actions.test.ts`: per-kind
  role gating, small/large threshold routing, revalidate, error mapping (8 cases).
- **Terminal-failure marking** — `runImportDurable` wraps the run; a deterministic
  failure marks `sync_runs.status='failed'`, which the poller now surfaces.
- **Latin-1 / Windows-1252 decode** — `decodeCsvBytes` (UTF-8 strict → win-1252
  fallback); UploadZone reads bytes not text. Verified live (Latin-1 "Crémerie Niño"
  decoded in-page; UTF-8 "Café au lait" round-tripped to DB). +6 unit cases.
- **occurred_at strict parse** — date-like guard + sane year window; rejects bare
  numbers a loose `new Date()` would misread.
Suite 192/192.

## STILL BLOCKED (real reasons, not deferred-by-laziness)
- **10k<30s / 50k perf bench** — needs a seeded Vercel Preview deploy (Local World
  runs synchronously, so local timing isn't the SLO). Streaming parse + Blob input
  staging pair with this.
- **Playwright memorable-element artifact harness** — needs Playwright wired into the
  repo (browser install + config). RTL + live verification is the current standard.
- **Workflow-boundary crash-resume integration test** — needs process-crash simulation
  in the DevKit runtime; the resume LOGIC is unit-tested on the core.
- **Raw-px → tokens** — held for the holistic post-Path-3 stack audit; craft guard passes.

## Block 6 Wave 6.1 (QBO adapter) — deferred from Codex 2026-06-05
Delivered this wave: the `QboSourceAdapter` engine, the connect screen with the
memorable forming chain, the cursor-drop fix (constant `floor` vs running
watermark), CSS cobalt demotion, the relocated/deepened memorable artifact, the
preview error-taxonomy surfacing, and the occurred_at TZ test.

Deferred to Wave 6.2 (live OAuth, needs Intuit creds in .env.local):
- **OAuth connect + `/api/qbo/oauth/callback`** — exchange code, encrypt tokens
  (`pgsodium`/Vault), insert `source_connections` with capabilities.
- **`qboInitialSyncWorkflow`** — durable run wiring the adapter to the commit path;
  the 60-second OAuth→first-sync SLO; token refresh + expiry alert.
- **Live PO write-back** — zero-duplicate round-trip verified against the sandbox.
- **Watermark tie-breaker** — `Metadata.LastUpdatedTime >` can skip rows sharing the
  boundary timestamp across runs; add an Id tie-breaker (`> ts OR (= ts AND Id > x)`)
  AND persist the final watermark on the terminal page (nextCursor=null currently
  drops it). Real only once incremental sync is wired.

Deferred to Wave 6.3:
- **`qboIncrementalSyncWorkflow`** + 15-min cron in `vercel.ts` + Intuit webhook
  (`createWebhook`) with signature verification.
- **Conflict policy** (server-wins / last-write-wins / needs_review) + `sync_conflicts`
  writes + `/flow/sync-conflicts` view + `resolveSyncConflict` + disconnect/revoke.

Deliberate design decisions (documented, not bugs):
- **PO round-trip identity** uses `DocNumber` (deterministic, queryable idempotency
  key) + `PrivateNote` (full tenant_id + internal PO id), NOT QBO "metadata fields" —
  QBO PurchaseOrder has no arbitrary metadata KV. Revisit a `CustomField` carry when
  write-back is live-verified in 6.2.
- **`stock_movement.source_ref`** is per-line (`qbo:bill:401:1`), not the bare QBO
  entity id — multi-line Bills/SalesReceipts need per-line uniqueness for dedup.
- **`occurred_at`** rewrites date-only `TxnDate` to midnight UTC; a full datetime
  passes through verbatim. Pinned by test.
- **inventory_level** mapping (Item.QtyOnHand) deferred; capability flag is false.
