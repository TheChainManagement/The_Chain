# Block 6 Wave 6.1 — QBO `QboSourceAdapter` engine + memorable connect screen

**Date:** 2026-06-05
**Scope:** Phase 6, Tranche B, Block 6 (QuickBooks Online), Wave 6.1.
**Status:** BUILT + live-verified + Codex round-1 applied. Ready to push.

## Codex round-1 (2026-06-05) — applied
Full-weight gpt-5.4 pass (`_reviews/2026-06-05_block6_wave6_1_qbo_adapter.md`). Fixed in-slice:
- **Cursor drop bug (correctness):** `pull()` reused the *advancing* watermark as the
  query filter while advancing STARTPOSITION, shifting the filtered set between pages.
  Fixed: a constant `floor` (the incremental filter, fixed per pull chain) is now
  separate from the running max watermark (persisted only). Regression test added with
  a WHERE-respecting transport proving lossless pagination under a floor.
- **CSS cobalt on chrome:** demoted `.panelMark` + `.sourceCta` to deep-slate so the
  chain ignite is the only cobalt on the surface; corrected the overclaiming comment.
- **Memorable artifact:** relocated to `_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx`
  (MASTER_PROMPT path; vitest include widened) and deepened to drive the real
  `ConnectPanel` pre-connect→post-sync transition, not just render `SyncChain`.
- **Preview error taxonomy:** `runQboSandboxSync` now distinguishes Retryable/auth/fault.
- **occurred_at TZ:** pinned by test (date-only→midnight UTC; full datetime verbatim).
- **matchMedia guard:** hardened for environments without `matchMedia`.

Ticketed/documented (see `_reviews/_tickets.md`): watermark tie-breaker + terminal-page
persistence (Wave 6.2 incremental), PO metadata-fields vs DocNumber/PrivateNote, per-line
source_ref, inventory_level, all OAuth/workflow/cron/webhook/conflict items (6.2/6.3).

## What this wave is (and isn't)

Block 6 is the biggest block in Wave 1 (full two-way ERP sync). It's split into waves:

- **Wave 6.1 (this) — the adapter engine + the connect screen, fixture-driven.** No Intuit credentials needed to build or verify. This is the `QboSourceAdapter` the block is named for, plus its hero visual.
- **Wave 6.2 — live OAuth + `qboInitialSyncWorkflow`** (needs MG's Intuit app + sandbox creds in `.env.local`).
- **Wave 6.3 — incremental sync (cron + webhook) + conflict-resolution policy + `/flow/sync-conflicts` UI.**

**NOT FEATURES-complete.** Engine-/credential-blocked contract items deferred to 6.2/6.3 are listed at the bottom.

## Built

### Adapter engine (`src/lib/qbo/`)
- **`capabilities.ts`** — `QBO_CAPABILITIES`. read products/suppliers/POs/movements + write POs + webhooks. `readInventory:false` (inventory_level from Item.QtyOnHand deferred; on-hand arrives via the movement ledger).
- **`types.ts`** — the QBO v3 API subset (Item, Vendor, PurchaseOrder, Bill, SalesReceipt/Invoice, query envelope, fault envelope). Mappers treat every field as untrusted.
- **`transport.ts`** — the `QboTransport` seam (mirrors how `CsvSourceAdapter` takes its sources by construction). `HttpQboTransport` is the real fetch layer; reads the bearer token per-request (never logged).
- **`client.ts`** — `QboClient`: builds the Query API + PO-create requests; maps HTTP → adapter error taxonomy. **429 → `RetryableError` with `retryAfter` from the header**, 5xx → `RetryableError`, 401/403 → `FatalError(code='auth')`, other 4xx → `FatalError` with Intuit's fault detail (never the token). Minor version pinned (73).
- **`map.ts`** — pure QBO→canonical mappers, each validated by the canonical Zod schema (a bad record → a `schema` error, never a throw). Item→product (Inventory only; service skipped), Vendor→supplier, PurchaseOrder→purchase_order, Bill→receipt movements, SalesReceipt/Invoice→sale movements. **Sign convention matches the CSV writer: sales negative, receipts positive.** `poDocNumber()` (deterministic, queryable, ≤21 chars) + `buildQboPurchaseOrder()` for the write-back.
- **`adapter.ts`** — `QboSourceAdapter implements SourceAdapter`. `pull()` runs **one Query page per call** (the natural `"use step"` granularity) and returns a `Cursor` for `sync_runs.cursor` resume; carries a high-watermark forward for the next incremental. `stock_movement` walks Bill → SalesReceipt → Invoice in sequence so each pull stays a single query. `push()` is **idempotent via a DocNumber round-trip lookup** — a retried push finds the existing PO and never duplicates.
- **`fixtures.ts`** — a realistic sandbox dataset + `FixtureTransport` that answers the Query API (parses FROM/STARTPOSITION/MAXRESULTS, paginates, DocNumber lookup returns empty, PO create echoes). Lets the connect preview run the REAL adapter with no network/creds.
- **`index.ts`** — public barrel.

### Connect screen (`src/app/(app)/integrations/`)
- **`/integrations`** — source connectors index (QuickBooks → set up; CSV → importer; Rutter → muted, later wave).
- **`/integrations/quickbooks`** — the connect screen. Server shell + `ConnectPanel` (client).
- **`SyncChain.tsx`** — the **memorable element**: SUPPLIERS → ORDERED → IN TRANSIT, each `ChainLink` igniting cobalt as its data arrives. Pre-connect shows the shape it will earn (all pending). `<ul>/<li>` semantics.
- **`ConnectPanel.tsx`** — connect CTA + the reveal state machine. Runs the sandbox sync, then ignites the links in sequence (respects `prefers-reduced-motion`). Honest framing: "Sandbox data. No QuickBooks account required." / "Preview complete. Nothing was imported. Live OAuth will import on connect."
- **`actions.ts`** — `runQboSandboxSync()`: runs the real adapter against the fixture transport, returns canonical counts. Read-only (imports nothing), needs only a signed-in session.
- **`integrations.module.css`** — tokens only; cobalt reserved for the chain's single intent slot.
- **Nav** — "Integrations" added to `LeftRail`.

## Verification

- **Typecheck:** clean (`tsc --noEmit`).
- **Lint:** clean (`biome check src`).
- **Craft guard:** PASS (`scripts/check-craft.mjs`). Note: cobalt was on `.panelMark`/`.sourceCta`
  chrome in the first cut (craft guard didn't catch it; Codex did) — demoted to deep-slate in
  round-1, so the chain ignite is now the only cobalt on the surface.
- **Tests: 226/226** (was 193; +33 — `tests/qbo/map.test.ts`, `client.test.ts`, `adapter.test.ts`, and `_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx`). Covers: mapping per entity incl. skip/sign/schema-error/occurred_at-TZ paths; client error taxonomy (429 retryAfter, 5xx, 401 auth, 400 fault detail); pull pagination + cursor; **lossless pagination under a floor (the cursor-drop regression)**; the Bill→SalesReceipt→Invoice walk; **push idempotency both branches**; the memorable artifact driving the real `ConnectPanel` pre-connect→post-sync transition.
- **Live browser (localhost:3100, fresh throwaway `qbo61-verify@thechain.test`):**
  - Pre-connect: chain renders SUPPLIERS/ORDERED/IN TRANSIT all pending.
  - Ran the sandbox preview → links igniting → all formed (`data-state`: `done,done,done`). QB mark now neutral grey; only cobalt is the primary CTA + the chain dots/connectors.
  - Final chain labels (real adapter output): **SUPPLIERS 4 vendors · ORDERED 2 orders · IN TRANSIT 1 open**.
  - Counts strip: **CATALOG 5 · RECEIPTS 3 · SALES 3 · ERRORS 0** — exactly the adapter's mapping of the fixtures (6 items − 1 service = 5; bill lines 1+2 = 3 receipts; sales lines 2+1 = 3; 1 Open PO = in transit).
  - No console errors.
  - **Evidence of record:** the `_reviews/..._memorable.test.tsx` interaction test + `data-state`/DOM assertions + the inline screenshot. Per the standing gotcha, `preview_screenshot` does NOT write a PNG to disk in this env — no on-disk `.png` is cited.

## Deferred (NOT in 6.1 — tracked to later waves)

- **Wave 6.2 (needs Intuit creds):** OAuth connect flow + `/api/qbo/oauth/callback`, `pgsodium`/Vault token encryption at rest, `qboInitialSyncWorkflow` durable run wiring the adapter to the commit path, token refresh, the 60-second OAuth→sync SLO, the live zero-duplicate PO write-back test against the sandbox.
- **Wave 6.3:** `qboIncrementalSyncWorkflow` + 15-min cron in `vercel.ts` + Intuit webhook (`createWebhook`) with signature verification, the conflict split policy (server-wins / last-write-wins / needs_review), `sync_conflicts` writes + `/flow/sync-conflicts` view + `resolveSyncConflict`, disconnect/revoke.
- **inventory_level** mapping (Item.QtyOnHand → canonical) — capability flag is currently false.

## Codex checklist pre-staged (for the gate)
- OAuth tokens: N/A this wave (no live tokens yet); `HttpQboTransport` reads the token per-request and never logs it.
- 429 → `RetryableError` with `retryAfter`: covered (`client.test.ts`).
- Push idempotency (no duplicate POs): covered both branches (`adapter.test.ts`).
- Memorable element in an interaction test: covered (`connect.memorable.test.tsx`) + live `data-state` capture.
- Workflow boundary / webhook signature / conflict-policy branch tests: Wave 6.2/6.3 scope.
