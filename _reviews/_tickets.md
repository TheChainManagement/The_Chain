
## W2-2 storeroom — deferred (2026-07-08)
- **Returns UI (`issue_return` / `return_to_vendor` / `customer_return`).** Enum + sign
  CHECKs shipped; `issue_return` is fully wired through `post_issue_movements`. Surfaces
  lag by design (kickoff Item 1: "UI can lag; the ledger vocabulary should be complete").
  Natural home: W2-3 procurement (vendor returns reference POs) + a distribution slice
  (customer returns).
- **Count-sheet design question (MG, walkthrough round 1):** he wants to think through a
  real inventory list for counting (pre-populated count sheets, count-by-area) vs the
  shipped SKU autocomplete (datalist, SKU + name only — blind count preserved). Revisit
  with W2-4 multi-location or a count deep build. Autocomplete capped at 2000 options;
  bigger catalogs still take typed entry.
- **E2E audit-read test** — "issue/adjust/count → rows appear in the audit VIEWER" is
  covered by pure transform tests (`tests/audit/event-detail.test.ts`) + live browser
  verification; a seeded end-to-end read through the viewer route joins the standing
  action-layer/seeded-auth harness ticket.
- **Prod migration reconciliation at merge:** linked remote shows `20260628140000` (W2-1a)
  unrecorded. Verify + apply W2-1a and the two W2-2 migrations
  (`20260707200000`/`20260707200100`) to prod BEFORE merging this branch to auto-deploying
  main.

## Wave 2 — DEFERRED BY DESIGN, DO NOT LOSE (2026-06-28)
- **Normalize UoM on the ingest write paths (W2-1b follow-up).** Manual product forms now write
  curated codes, but CSV import (`commit.ts`/`durable-commit.ts` product writers) and QBO sync
  (`sync-core.ts`/`incremental-core.ts`) still persist whatever free-text the source provides. The
  DISPLAY + edit layer normalizes via `resolveUomCode`/`uomLabel` (so surfaces stay consistent), but
  the stored column is still semantically mixed. Optional hygiene: run `resolveUomCode` in the
  product import/sync writers to store the canonical code when it resolves. Codex-flagged 2026-06-28;
  display normalization shipped, write-side normalization deferred (behavior-changing on ingest).
- **Durable writer for the product-supplier link lane (W2-1a).** The links import runs sync-only
  (the action forces `product_supplier` off the durable path; `durable-commit.ts` throws
  defensively). Fine today — link files are small (one row per pair). If a customer ever bulk-loads
  a >2000-row link file, add a durable `prepareProductSupplierLinks` mirroring the other kinds.
  Codex-flagged conscious deferral, 2026-06-28.
- **🔴 Ledger header/line split (`stock_movement_events` + `stock_movement_lines`).** MG
  approved deferring this from the W2-0 spine but explicitly said "do NOT lose it." Today's
  single-row `stock_movements` (one product / one location / one signed qty) cannot atomically
  carry a multi-line event or split a line across lots/serials. **TRIGGER to build = the first
  event that needs ATOMIC multi-line or lot/serial sub-lines = the Manufacturing / Produce wave
  (or a lot-traceability deep build if that lands first).** NOT needed for W2-2 storeroom (kit =
  N `issue_out` rows sharing one `demand_ref_id`), W2-3 procurement (POs already use
  purchase_orders + lines), or W2-4 transfers (two-row model). **Pull forward only on an
  early-warning sign:** a multi-line atomic reversible pick list, or food FEFO lot-picking
  arriving early. **HOW (additive, not a rewrite):** create events+lines; backfill 1:1 (the W2-0
  `demand_ref_*` / `reason_code` / `source` columns LIFT to the header, product/location/qty drop
  to the line); keep a backward-compat VIEW in the old single-row shape so reads migrate
  incrementally. Only cost of waiting = backfill grows with row count (bounded, O(rows)). Full
  rationale: `docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md` §10.

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

## Block 6 Wave 6.2a (live OAuth) — Codex 2026-06-05 dispositions
Fixed in-slice: half-connected persistence bug (creds written before status flips
to active), env-gating (configured flag → unavailable state instead of a crashing
Connect button), memorable artifact deepened (now drives the connected "Run sync"
live path, not just the sample preview), connection-layer integration test
(save/load/status/deactivate + ciphertext-at-rest, validates the persistence fix),
FEATURES.md pgsodium→app-side-AES contract corrected.

Ticketed / documented:
- **idempotency_key on connect/sync/disconnect actions** — MASTER_PROMPT names the
  rule for external-WRITE actions. startQboConnect (cookie + read), runQboLiveSync
  (read-only + last_synced stamp), disconnectQbo (revoke) are naturally idempotent
  and create NO external records, so a literal idempotency_key param would be
  unused cargo-cult. The genuine record-creating external write — the PO push —
  already carries idempotencyKey in the adapter. Revisit if MG wants the literal
  param on these. (Decision logged in the Codex review.)
- **Callback-route + Server-Action-layer integration tests** — the connection/factory
  layer is now covered (tests/qbo/connection.test.ts); the Next request-context route
  + action wrappers still need a harness. Ticketed.
- **True Playwright 3-state memorable capture** (pre/mid/post during first sync after
  connect) — Playwright isn't wired in the repo (shared infra ticket from Block 5).
  Current artifact is RTL driving the real ConnectPanel live + sample paths.
- **Raw-px → tokens** in integrations.module.css — same holistic stack-audit ticket
  as Block 6.1 (MG already dispositioned; craft guard passes; matches codebase
  convention for font/structural sizes).
- **Production env + redirect URI** — QBO_* + QBO_TOKEN_ENC_KEY in Vercel Production
  + the production redirect URI registered on the Intuit app (for live prod use).

## Block 6 Wave 6.2b — Codex round-1 tickets (2026-06-06)
Review `_reviews/2026-06-06_block6_wave6_2b_qbo_durable_sync.md`. Fixed in-slice:
UI lede no longer overclaims PO write-back; poller fast-fails on persistent
`unknown` (missing run / bad key / RLS) instead of spinning to the 10-min cap.
Deferred (slice boundary — Wave 6.3 unless noted):
- **`qboIncrementalSyncWorkflow` + 15-min `vercel.ts` cron + Intuit webhook**
  (`createWebhook()` signature-verified) — delta sync. (FEATURES §QBO step 5.)
- **Conflict policy + `/flow/sync-conflicts` + `resolveSyncConflict`** — server-wins
  for our POs, LWW by external_updated_at for catalog/vendor, never overwrite
  receipts, needs_review otherwise. (FEATURES §QBO step 6.)
- **PO write-into-`purchase_orders`** on initial sync — needs the line-item +
  PO-status model. Adapter `push('purchase_order',…)` already exists + is unit
  tested but isn't called from production yet (that's the write-back, Wave 6.3).
- **60s OAuth→first-sync SLO** measured on a seeded Vercel Preview; **generated-PO
  round-trip** zero-dup test against the sandbox. (FEATURES §QBO acceptance.)
- **Supplier contact enrichment** — QBO email/phone/web are pulled but not yet
  persisted (the supplier writer matches the CSV columns; add a contact jsonb write).
- **Playwright 3-state memorable capture** — infra-blocked (Playwright not wired);
  jsdom RTL artifact stands in. (Standing across blocks.)
- **Action-layer integration tests** for `runQboInitialSync` / `getQboSyncProgress`
  (role-gating, run pre-create, revalidate, error mapping) — the memorable test
  mocks both. (Standing across blocks.)
- **Raw-px → tokens** in `integrations.module.css` (incl. the new `.importedLink`
  12px / 3px) — stack-audit pass. No font-size token exists yet in this file.

## Block 6 Wave 6.3-A — Codex round-1 tickets (2026-06-08)
- **Incremental sync (own session):** `qboIncrementalSyncWorkflow` (delta via `Cursor.highWatermark`) + 15-min cron in `vercel.ts` + Intuit webhook via `createWebhook()` (signature-verified) + conflict policy (server-wins for our POs / LWW by external_updated_at for catalog+vendor / never overwrite receipts / needs_review) + `/flow/sync-conflicts` + `resolveSyncConflict`. The remaining Block 6 contract.
- **Generated-PO write-BACK (blocked):** adapter `push()` exists + unit-tested but unused in prod. Blocked until the Blocks 7-9 reorder engine generates POs to push. Wire it when there are app-origin POs.
- **Playwright 3-state connect-screen artifact (infra-blocked):** FEATURES.md Block 6 requires a Playwright capture of the connect chain at pre-connect / mid-sync / post-sync. Still substituted by vitest/jsdom memorable tests. Needs the Playwright harness on a seeded Preview.
- **Action-layer tests for `runQboInitialSync` / `getQboSyncProgress`:** coverage lives in sync-core + pure UI; the Server Action boundary itself is untested. Add when the action-layer harness lands (shared ticket with prior waves).
- **No PO detail route:** cockpit rows link to the supplier. A dedicated `/purchase-orders/[id]` detail (line table, receipts, history) when the lifecycle (Blocks 10-11) gives it content.

## Block 6 Wave 6.3-B — Codex round-1 tickets (2026-06-09)
- **Wave 6.3-C — conflict resolution UI:** `/flow/sync-conflicts` cockpit + `resolveSyncConflict(conflictId, resolution, merge_payload?)` (accept_local/accept_remote/merge). Wire the IncrementalSyncControls "N changes need review" badge to link there (currently a `role=status` indicator; data is safe/queued, just no resolution surface yet).
- **Wave 6.3-D — Intuit webhook:** ~~`createWebhook()` at `/.well-known/workflow/v1/webhook/:token`, signature-verified, triggers `qboIncrementalSyncWorkflow` (vs polling cron only).~~ **DONE 2026-06-10** — shipped as an Intuit-native route handler at `/api/qbo/webhook` (Intuit's fixed-URL + `intuit-signature` HMAC scheme doesn't fit the DevKit per-token webhook; same deviation class as vercel.json/vercel.ts). Signature-verified, refuse-by-default on unset `QBO_WEBHOOK_VERIFIER_TOKEN`, coalesces bursts. See `_reviews/2026-06-10_block6-wave6_3d-intuit-webhook.md`. Remaining: set `QBO_WEBHOOK_VERIFIER_TOKEN` in prod + register the URL in the Intuit portal (manual).
- **PO delta + server-wins:** wire PO delta refresh into incremental + restore `decidePoConflict` (server-wins for app POs). Blocked on the Blocks 7-9 reorder engine generating app POs; until then every PO is external (refresh = the import path already covers it).
- **cron in vercel.json not vercel.ts:** acceptance criterion says `vercel.ts`; shipped `vercel.json` to avoid the `@vercel/config` dependency (functionally identical). MG decision pending whether to switch.
- **Expired-refresh-token → `sync_failure` alert:** acceptance criterion (FEATURES.md:277). Cross-cutting (applies to initial sync too) — neither path writes an `alerts` row on auth failure today; both only mark `sync_runs` failed. Needs the alerts-write helper.
- **Receipt-revision edge cases:** test duplicate external receipts with corrected quantities + same source_ref with changed timestamps + QBO revising a bill after first sync. Append-only "never overwrite receipts" holds; the edge reconciliation is untested.
- **Playwright 3-state connect artifact** (carried from prior waves) — infra-blocked.
- **`CRON_SECRET` in Vercel production env** before the cron runs (safe default: unset → route refuses).

## Block 6 Wave 6.3-C — Codex round-1 tickets (2026-06-10)
- **`warn` alert on `needs_review` conflict (FEATURES.md:288):** the detection path logs the conflict row but writes no `warn` alert. Deferred to the alerts engine wave — the engine has dedupe / severity-rise logic (FEATURES.md:509) that a naive insert here would fight. Fold the alert write into `logConflict` once that helper exists. (Shares the alerts-write helper with the expired-refresh-token ticket above.)
- **PO server-wins branch test:** still no app-generated POs until the reorder engine (Blocks 7-9), so `decidePoConflict` stays an unused pure helper. Add the server-wins branch + test when PO delta refresh lands (shares the "PO delta + server-wins" ticket above).
- **Real-route E2E for `/flow/sync-conflicts`:** the gallery showcase + RTL memorable test prove the component + the action contract, not the live route against real pending rows + the real Server Action under auth/RLS. Add when the action-layer + seeded-auth harness lands (Phase 7).
- **RPC-transaction hardening for `resolveSyncConflict` (optional):** the action is now effectively atomic via claim-first compare-and-set + claim-release on entity-write failure. A SECURITY DEFINER RPC doing both writes in one Postgres transaction would be the gold standard (matches the existing supplier-link / base64-bridge RPC pattern). Only worth it if the compensate path ever proves insufficient.

## Block 7 Wave 1 (ABC/XYZ classification) — Codex round-1 tickets (2026-06-10)
- **Quadrant drag-zoom + filtered SKU list + URL zoom state (wave 1b):** FEATURES.md:312/318/326 — the heavier quadrant UI. Shipped static-first (MG-approved); add zoom-into-cell, a filtered SKU ledger below the grid, and zoom captured in searchParams.
- **Classification inside `forecastTenantBatchWorkflow` + scheduled run (wave 2):** FEATURES.md:308 — classification currently runs via a synchronous Server Action; the forecast batch will own the durable/sharded scheduled run and reuse the pure `classify`/`compute` modules.
- **Per-location classification:** `product_classifications.location_id` is wired; engine writes tenant-wide (`null`) today. Compute per (tenant, product, location) when multi-location demand exists.
- **Threshold-version lifecycle:** a new `classification_thresholds` version should trigger a reclassify run; retain prior classifications in `audit_log` for replay; build the owner/manager threshold editor UI (only default v1 is seeded today).
- **Forecast-view method routing (wave 2):** route intermittent SKUs (stored ADI ≥ ~1.32) to Croston/SBA/TSB in the forecast pipeline; surface the routed method on the forecast view.
- **Classification scale: p95 < 1.5s for 5k SKUs (FEATURES.md:317) + `loadQuadrant` query shape:** needs the seed-5k harness (shared with the forecast bench tickets). Current two-query + in-memory group is fine at small scale.
- **Playwright quadrant capture (full + zoomed A/X):** FEATURES.md:326 — still substituted by the jsdom memorable test (Playwright not wired in the repo; carried ticket).
- **Price basis for ABC:** cost-based today (no price field). Honor `revenue_basis='price'` when a price source exists.

## Block 8 Wave 2a (forecasting foundation) — deferred to 2b/2c (2026-06-10)
- **Wave 2b — durable forecast batch:** `forecastTenantBatchWorkflow` → `forecastShardWorkflow` (200-SKU shards, `tenants.forecast_concurrency_limit` cap, backpressure halves on RetryableError); calls `/api/forecast` per SKU; writes `forecasts`/`forecast_points`/`forecast_evaluations`/`inventory_policy` idempotently on `(tenant,product,run_id)`; promotes only `beats_baseline`; computes the distinct-sale-day count feeding `eligibility`; nightly cron + `recomputeForecast(productId, locationId)` action.
- **Wave 2b — category benchmark:** `category_benchmarks` trimmed-mean over warm SKUs in the same `products.attributes.category`, refreshed in the batch; cold SKUs filled from it, never a model prediction.
- **Wave 2b — audit cold→warming→warm transitions** (acceptance criterion).
- **Wave 2c — the forecast chart** (`/forecasts/[productId]`): history + forecast + 80/95% confidence bands + cobalt today-diamond + RMSSE lift caption. THE memorable element + the Playwright capture. Replaces the `/forecasts` BenchStub and lights the SKU-detail "FORECASTED" lifetime-chain link.
- **Wave 2b — forecast bench:** `bench:forecast` harness, 5k SKUs p95 < 15 min + 50k no-OOM on a seeded Preview; sharding visible in `sync_runs.error_log`.
- **`statsforecast` cold-start/bundle weight** — measure on the first real deploy (numba/scipy). If the Vercel function is too heavy/slow, revisit (lighter method set, warm pool, or precompiled).
- **Python function runtime test** — no pytest harness in the repo; the function is syntax-checked + TS-tested only. Add a minimal pytest (or a deployed smoke test) when the Python toolchain is wired.

## Block 8 Wave 2b — tickets (2026-06-12)
Review `_reviews/2026-06-11_block8_wave2b_forecast_batch.md`; fixed-in-slice items
recorded there (bundle RPC, retryable backpressure, recomputeForecast action,
loading.tsx, terminal-failure marking, the live-caught Block 7 classification
recompute bug).
- **Forecast batch 5k p95 < 15min + 50k no-OOM stress** — seeded Vercel Preview
  harness (pairs with the standing import 10k/50k bench ticket). Tuning knobs:
  in-chunk API pool (4), CHUNK_SIZE (25), SHARD_SIZE (200), tenant concurrency.
  Also: watch the Python function cold start / bundle weight on first deploy.
- **`src/workflows/steps/` one-shot alignment** — MASTER_PROMPT names the folder;
  all five shipped workflow files keep steps inline. Move them together at the
  stack audit, not per-wave.
- **moretech plugin: add `moretech-codex-review` to its own skill registry** so
  the compliance audit stops flagging the gate that is running it.
- **Per-location forecasting** — engine writes location_id null (tenant-wide);
  `recomputeForecast` refuses locationId honestly. Activates with the Wave-2
  multi-location dry run (FEATURES Block 1 criterion).
- **Workflow-loop orchestration tests** — same accepted class as the cron routes;
  revisit if the loop grows branches.

## Block 8 Wave 2c — notes (2026-06-12)
Review `_reviews/2026-06-12_block8_wave2c_forecast_chart.md`; in-slice fixes recorded
there (full-history paging, read-model tests, ledger labels, CSS claim corrections,
plugin registry heading). No new tickets — Playwright harness, raw-px→tokens,
per-location forecasting, and the 5k/50k bench all remain on their standing entries.

## Block 11b — deferred (2026-06-13)
From `_reviews/2026-06-13_block11b_approve_receive_stock.md` (Codex review). In-slice fixes
(approve-copy honesty, past_due gate, StatNumber total, on-contract memorable artifact) landed;
these are the accepted-deferred items:

- **6-month wait + `process.exit(0)` crash/resume tests** (FEATURES.md:461,467). The integration
  test proves token park + resume + per-PO isolation. The indefinite hook-park IS the long-gap
  mechanism (no timer to skip), and crash-resume is a DevKit runtime guarantee that's awkward to
  unit-test in-process. Revisit if we adopt a workflow max-age policy or see a real stuck run.
- ~~**QBO `sent`-path unit test for approve-core.**~~ CLOSED 2026-06-23. `approve-core.ts` now
  seams the QBO factory via `ApproveDeps.createAdapter`; `tests/purchase-orders/approve-core.test.ts`
  covers the connected push→`sent` path (entity id + DocNumber persisted, in-transit committed),
  degrade-on-push-failure → `exported`, and mapped-but-not-connected → `exported`. Production passes
  no deps → the real factory is used. (Live acceptance against the Intuit sandbox still pending MG's login.)
- ~~**Supplier scorecard panel on the PO detail hero** (FEATURES.md:451).~~ CLOSED 2026-06-23.
  `/purchase-orders/[poId]` now renders a Supplier reliability panel (reusing `ReliabilityRibbon` +
  `getSupplierDetail`'s rolling-30d OTIF / on-time / in-full / actual lead time) between the order
  chain and the lines, with a "Full scorecard →" link. Reliability now sits where the approve/receive
  decision is made. Live-verified.
- **`audit_log` lifecycle assertion test** (FEATURES.md:468). Audit triggers fire on every
  `purchase_orders` transition (trigger present, audit suite green); add a focused test asserting
  approve/partial/full-receipt/export rows for belt-and-suspenders on the money path.
- **5-state chain vs 4 visual nodes** (FEATURES.md:458). The chain collapses draft/recommended/
  approved and exported/sent into shared frontiers by design (Block 10 abstraction). If MG wants a
  literal 5-transition readout, that's a chain redesign — decide at the stack audit.

### Contract reconciliation (intentional forks, recorded in FEATURES.md)
- PO detail/receive live at `/purchase-orders/[poId]` (reuses the Block 10 / Wave 6.3-A cockpit),
  NOT `/app/reorder/po/[poId]` + a separate `/receive` route as the original block sketch said.
- Approval runs **synchronously** in the Server Action (immediate sent/exported feedback); the
  durable workflow owns only the long receipt wait + finalize — not the approve→push→wait chain.
- `approvePurchaseOrder({ poId })` — no explicit `idempotency_key` param; idempotency is enforced
  by the DB (PO status guard + DocNumber-keyed QBO push), so a re-click can't double-commit.

## In-app alerts engine — deferred (2026-06-13)
From `_reviews/2026-06-13_alerts_engine_evidence.md`. Core engine + 6 conditions + queue UI shipped;
these are the accepted-deferred items:

- **forecast_low_confidence + forecast_baseline_fail conditions.** The other two FEATURES alert
  kinds. Need a forecast-confidence read (forecast_evaluations / forecasts bands) wired into the
  generation inputs. Add when the forecast-confidence surface is needed.
- **Alert tray (slide-in right rail)** — FEATURES step 4. The `/flow/alerts` queue is the memorable
  Wave-1 surface; the in-context tray is additive.
- **Email channel** — FEATURES step 6: `notification_preferences.channel='email'` + Resend, disabled
  by default. In-app (the alert row) is the Wave-1 notification. Includes the `(alert_id, channel)`
  idempotency the Codex checklist calls for once email exists.
- **"After each sync" generation hook** — generation currently runs after the forecast batch + on
  demand (`recomputeAlerts`). Wiring it into the incremental-sync tail is a small follow-up.

## Block 12 (AI insights) — Wave B SHIPPED (2026-06-14); follow-ups remain
Wave A (engine + "Why this reorder") AND Wave B all shipped + live-verified:
- ✅ **"Why this forecast"** (B1) — `/forecasts/[productId]`.
- ✅ **"What changed this week"** (B2) — `/flow`, with a "This week" count strip grounding the digest.
- ✅ **What-if interpretation** (B3) — `/inventory/policy`, server-derived facts + "Saved ·" baseline ref.
Block 12 is feature-complete (4 insight kinds). Remaining open follow-ups (Codex round, 2026-06-14):

- **Right-rail placement** — insights render inline (PO/forecast/flow/bench); FEATURES specifies the
  app right rail. The bench layout HAS a `CONTEXT` right rail with placeholder copy; moving insights
  there needs a page → layout slot hand-off. (Deviation flagged; inline is the shipped choice.)
- **Per-tenant insight cost counter in admin** — per-call token usage is logged to stdout; surface the
  aggregate (FEATURES Codex checklist; the Wave-1 counter seam).
- **Durable step-wrapped generation** — on-view generation is a cached Server Action (request-path,
  not a durable job); FEATURES/MASTER_PROMPT name a `"use step"` wrapper. Revisit if/when insight
  generation moves to a batch/background path.
- **Model-fallback live drill** — verify the gateway fallback chain fails over when the primary model
  errors (config in place; needs a forced-failure test).
- **Reorder insight trust surface** — the PO detail page shows ordered qty/dates/total but not the
  on-hand / DOS / ROP / stockout numbers the reorder insight cites; add a policy-context stat row so
  every cited number is on-screen (same fix shipped for B2 digest + B3 what-if).
- **Reorder narrates first PO line only** — weak for grouped multi-line supplier buys; summarize the
  order, not the lead line.
- **Weekly digest same-day staleness** — cache keyed by date, so same-day new alerts/receipts don't
  refresh the prose until the date rolls. Key on a count fingerprint if freshness matters more than cost.
- **Insight error granularity** — all failures collapse to one generic `ClaudeInsight` error; the
  underlying reason is discarded by the panel loaders.

## Block 15 (`/today` dashboard) — BUILT + Codex-gated 2026-06-16; follow-ups
Shipped: centerpiece chain + heartbeat→acknowledge memorable interaction, clickable
metric strip (most-used supplier OTIF by PO volume), Claude top-recommendation +
recent alerts, throughput ruler, all 3 population states (fresh/onboarding/populated).
Evidence `_reviews/2026-06-16_feature_today_dashboard.md`; Codex round-1
`_reviews/2026-06-16_block15_today_dashboard.md`. Deferred:
- **`bench:dashboard` 5k SLO (p50<800ms/p95<1.5s)** on a seeded Vercel Preview — the
  acceptance bench. Shares the standing seeded-Preview harness ticket (Local World
  timing isn't the SLO). The `bench:dashboard` script itself isn't written yet.
- **Insight + alerts into the layout `RightRail` slot** — today's right column lives
  in the page; the standing `<RightRail>` is still placeholder copy. Needs a
  parallel-route / layout-slot hand-off. Shared with the Block 12 right-rail ticket.
- **Per-section Suspense streaming + precise `'use cache'`/`cacheTag` tags** —
  CROSS-CUTTING, not Block-15-specific: the whole app uses dynamic RLS reads + PPR +
  `revalidatePath`; no block uses `'use cache'`. `/today` streams behind the segment
  `loading.tsx` boundary today. Adopt `'use cache'` tagging as one architecture pass.
- **Playwright capture of the pulse-on / pulse-off states** (FEATURES Block 15) —
  infra-blocked (Playwright not wired); the driveable RTL interaction test +
  live browser verification stand in, per the standing substitution.

## Block 2 — Onboarding (Wave 2a, 2026-06-17)
- **`onboardingWorkflow` formal orchestrator** — MG-approved deviation: onboarding
  runs as a state-machine over `onboarding_state` + reuse of the existing
  `qboInitialSyncWorkflow` / `forecastTenantBatchWorkflow`, not a new `"use workflow"`
  orchestrator that would only park on user clicks. Revisit only if a future step
  needs genuine durable orchestration.
- **QBO / CSV in-chain live sync progress (Wave 2b)** — the path-picker sets the path
  and hands off to the existing `/integrations/quickbooks` and `/import` surfaces;
  the chain tracks their catalog/supplier minimums from live counts. Streaming the
  sync run inside the onboarding chain (consume the workflow `getReadable()`) is 2b.
- **Populate `onboarding_state.minimum_fields_met` jsonb** — currently unused. MG call
  (2026-06-17): keep functional minimums (SKU+name / supplier name); the engine needs
  no unit cost (Block 9 = no cost params) and lead time is honestly optional (policy
  skips no-lead-time SKUs). Write the jsonb per step for the record in a follow-up.
- **Action-layer integration tests for the onboarding actions** — incl. the
  skip-before-path regression (seedOnlyOptIn upsert) and the atomic-RPC rollback
  paths. The pure step-machine is unit-tested; the live happy-path + bypass + guards
  were browser-verified this session. Consistent with prior blocks deferring
  action-layer tests.
- **Playwright 3-state onboarding-chain capture** (FEATURES Block 2 required artifact)
  — infra-blocked (Playwright not wired); the RTL `_feature_onboarding_chain_memorable`
  test (empty → 2/5 → 5/5) + live browser verification stand in, per the standing
  substitution.

## Block 2 — Onboarding (Wave 2b, 2026-06-18)
- **`product_supplier` CSV import lane** — onboarding/import expose product, supplier,
  and stock_movement kinds only; product↔supplier links (with unit_cost + lead_time)
  are created via the fresh-path RPC and QBO sync, not CSV. A CSV link lane would be a
  new import kind — separate feature, deferred.
- **Onboarding acceptance E2E** — pilot-qbo / pilot-csv / pilot-fresh end-to-end +
  crash/resume after process.exit. Engines are tested; the onboarding wiring is
  browser-verified (CSV full; QBO connect-initiation). Action-layer + E2E deferred.

## Block 14 — Audit log (Wave 14a shipped 2026-06-19; below deferred)
- **Wave 14b — cold archive** — `coldArchiveWorkflow` (daily cron), Vercel Blob upload,
  `cold_archives` table (id, tenant_id, partition_name, blob_url, archived_at),
  `restoreColdPartition(tenantId, partitionName)` re-attach on upgrade, round-trip
  bit-identity test. NOTE: the global retention floor is 10 years, so this workflow
  never detaches a real partition for a decade — pure correctness-plumbing, zero
  operator-visible value today. Build when storage cost or a real >10y tenant warrants.
- **Audit p95 < 500ms bench** for a tenant with 12 months of history — seeded Vercel
  Preview harness, same shape as the inventory/forecast benches.
- **Playwright vertical-chain capture** (FEATURES Block 14 required artifact) —
  infra-blocked (Playwright not wired); the RTL `_feature_audit_chain_memorable` test
  (chain renders, today node, expand-on-click, upgrade stub, export link) + live browser
  verification stand in, per the standing substitution.
- **Role-abuse 403 as a live HTTP test** — viewer/planner GET the CSV export → 403.
  Unit-covered via `canReadAudit` (all 6 roles) + the route's explicit gate; a full
  HTTP role-switch test needs a seeded non-privileged session (action-layer deferral,
  consistent with prior blocks).
- **Load-more / cursor** beyond the 200-row viewer page — the viewer now shows the most
  recent 200 in the window AND says so honestly ("Showing the most recent N… download the
  CSV for the full record"); the CSV is the full paginated window. A cursor/load-more in
  the UI is the remaining nicety (Codex round-1: the silent-drop part is fixed).
- **Entity-filter chip list scans only the first 2,000 rows** (`listAuditEntityTypes`) —
  rare entity types can drop off the filter controls on a very noisy tenant. A correct
  distinct needs an RPC (= a migration, out of the no-migration 14a scope). Cosmetic;
  filter convenience, not data correctness. (Codex round-1, ticketed.)

## Block 17 — Marketing (17a + 17b shipped 2026-06-20; below deferred to 17c)
- **/about + /contact pages** (FEATURES Block 17 step 5) — small, on-direction.
- **SEO: OG image + JSON-LD structured data** — home has title/description; needs an
  OpenGraph image and Organization/Product JSON-LD across the marketing routes.
- **Lighthouse Performance ≥ 90 on the hero** (acceptance) — seeded Preview run, same
  shape as other block benches.
- **Playwright hero-capture** (FEATURES required artifact) — infra-blocked (Playwright
  not wired); RTL memorable + live DOM/screenshots stand in. Re-scope once the hero
  visual lands.
- **Dedicated retention compare-table on /pricing** — per-tier "History retained" row
  is comparable across columns today; a dedicated compare strip is a nicety.
- **Hero visual** — MG pulled the chain render for a clean opening; revisit the hero
  imagery "further down" (the optimized renders are held in `public/marketing/`).

- [ ] W2-2.5 (Codex 2026-07-09): browser-level Playwright page-flow test for /inventory hold/release + PO receive conversion rail (jsdom RTL exists; page-level flow does not). Pairs with the standing Lighthouse-on-Preview ticket.
- [x] W2-2.5 (Codex 2026-07-09): MG decision — Wave-2 feature contract home: kickoff doc vs FEATURES.md backfill. **RESOLVED 2026-07-11: FEATURES.md backfilled (Wave 2 section, commit `7df9ee8`); kickoff doc stays the session log.**
- [x] W2-2.5 (walkthrough 2026-07-12): extend `scripts/seed-storeroom-demo.mjs` with a case-packed open PO (purchase_uom + factor on the supplier link) so the receive conversion rail is walkable on the demo tenant. **DONE 2026-07-15 on `codex/w2-fast-follows`; `DEMO-CASE-PO` carries `case x 12`.**

## W2-3 procurement deferrals (2026-07-13)

- [ ] **Email RFQs from the app.** The signed-off W2-3 delivery mode is
  export-for-manual-send. Add sender-domain/deliverability work, per-tenant reply-to, and
  delivery/audit state only when MG opens the fast-follow. **DIRECTION LOCKED 2026-07-15: retain
  export/manual send; integrated sending must use a customer-owned Google Workspace or Microsoft
  365 mailbox via OAuth, never a shared The Chain sender. See the dated decision brief.**
- [x] **Direct requisition creation UI.** The schema supports a requisition without an RFQ,
  but Scenario A and W2-3 ship the quote-award creation path. Design the direct form when a
  real operator case requires "I know what I want approved." **DONE 2026-07-15 on
  `codex/w2-fast-follows`; direct drafts snapshot the supplier conversion rail and stay documents-only.**
- [x] **Direct requisition line editing.** The RFQ award is the W2-3 editor. Rejected
  documents can resubmit unchanged; changed sourcing or quantities use cancel plus re-award.
  Add line editing with total recalculation and quote-lineage rules before promising it. **DONE
  2026-07-15 on `codex/w2-fast-follows`; DRAFT/REJECTED add/edit recalculates totals and clears
  quote lineage on edit.**
- [x] **Re-award versioning or one-award lock.** W2-3 intentionally permits a new draft
  requisition for each award while the RFQ remains open. Revisit when MG chooses between an
  immutable award history, superseded-version links, or a one-award lock. **DECIDED 2026-07-15:
  Option C, versioned re-awards. Superseded versions are immutable and only the current version can
  submit, approve, or convert. **DONE 2026-07-16 on `codex/w2-fast-follows`; atomic RFQ award
  versions, lifecycle guards, read-only history UI, cross-tenant probe, and converted-award safety
  stop are implemented.**

## Wave 3 (2026-07-18)

- [ ] **Full end-to-end demo/test data for a complete operational run-through.** MG (2026-07-18)
  created warehouse/requester members on the W3 team bench and wants to eventually run the whole
  system start to finish, but the demo tenant has no operable catalog. Seed vendors + SKUs (and the
  supplier links / costs / UoM factors, plus enough on-hand and an open PO) so a fresh tenant can go
  forecast → reorder → RFQ → award → requisition → approve → PO → receive → transfer without hand
  seeding. Extend `scripts/seed-*.mjs`. **DEFERRED by MG until we're further along; do this before
  the first full end-to-end walkthrough, not now.**
