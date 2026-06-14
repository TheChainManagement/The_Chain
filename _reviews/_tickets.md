
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
- **QBO `sent`-path unit test for approve-core.** Current coverage exercises the manual `exported`
  path against real Postgres; the connected write-back path needs a mocked QBO connection fixture.
  Add alongside the next QBO adapter test pass.
- **Supplier scorecard panel on the PO detail hero** (FEATURES.md:451). The page links to the
  supplier record (full ReliabilityRibbon lives there); surfacing the rolling-30d OTIF *on* the PO
  page would put reliability where the approve/receive decision happens. Cheap follow-up with the
  existing `ReliabilityRibbon` + the queue's scorecard read.
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

## Block 12 (AI insights) Wave A — deferred (2026-06-14)
From `_reviews/2026-06-14_block12_ai_insights_evidence.md`. Engine + "Why this reorder" on the PO
detail page shipped + live-verified. Wave B / follow-ups:

- **"Why this forecast" surface** — prompt builder + ForecastFacts already stubbed in `prompts.ts`;
  wire facts assembly (forecast row + bands + RMSSE) + a panel on `/forecasts/[productId]`.
- **"What changed since last week" insight kind** — third FEATURES kind; needs a prior-period diff.
- **What-if slider entry point** — adjust service level / lead time → recomputed `<StatNumber>` +
  a Claude "if you do this, here's what changes" continuation (FEATURES step 5; the memorable's
  hairline-divided continuation).
- **Right-rail placement** — insights render inline on the PO page; the FEATURES "right rail in app"
  needs a layout slot mechanism (page → layout entity hand-off).
- **Per-tenant insight cost counter in admin** — per-call token usage is logged today; surface the
  aggregate (FEATURES Codex checklist; the Wave-1 counter seam).
- **Durable step-wrapped generation** — on-view generation is a cached Server Action; batch/
  background insight generation should move into a `"use step"` for retry/durability.
- **Model-fallback live drill** — verify the gateway fallback chain actually fails over when the
  primary model errors (config is in place; needs a forced-failure test).
