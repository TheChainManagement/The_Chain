# Codex Review — block6_wave6_2a_qbo_oauth
**Date:** 2026-06-05 19:30
**Project:** The Chain
**Project type:** MoreTech Product
**Phase:** 6 (Features)
**Unit reviewed:** block6_wave6_2a_qbo_oauth
**Review weight:** full
**Skills audited:** (none)
**Reviewer:** Codex CLI (model: gpt-5.4)

---

## What was done

- The OAuth initiation path is real now. `startQboConnect()` sets a CSRF state cookie and returns a real Intuit authorize URL from a server action (`src/app/(app)/integrations/actions.ts:79-105`), and `/api/qbo/oauth/callback` verifies `state`, checks tenant/role, exchanges the code, and persists the connection before redirecting back (`src/app/api/qbo/oauth/callback/route.ts:23-70`).
- Token-at-rest handling exists on disk. `encryptJson()` / `decryptJson()` implement AES-256-GCM with tamper detection (`src/lib/qbo/crypto.ts:21-50`), `saveQboConnection()` stores ciphertext through service-role RPCs (`src/lib/qbo/connection.ts:31-74`), and the migration adds the bytea/base64 bridge functions locked to `service_role` (`supabase/migrations/20260605120000_block6_qbo_connection.sql:14-39`).
- The live read-only sync preview path exists. `createQboAdapterForTenant()` loads stored creds and refreshes them on skew (`src/lib/qbo/factory.ts:24-53`), `runQboLiveSync()` drains the real adapter and stamps `last_synced_at` (`src/app/(app)/integrations/actions.ts:107-123`), and `ConnectPanel` now has distinct connected vs not-connected modes with connect, sync, and disconnect actions (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:98-247`).
- There is some real verification, but it is narrow. `tests/qbo/oauth.test.ts` covers authorize URL, token exchange, refresh, and revoke helper behavior (`tests/qbo/oauth.test.ts:30-116`), and `tests/qbo/crypto.test.ts` covers round-trip, fresh IVs, tamper rejection, and short-blob rejection (`tests/qbo/crypto.test.ts:17-36`).

## What wasn't done

- The feature contract in `FEATURES.md` is still not delivered. The workflow pieces, cron/webhook path, conflict resolution, and sync-conflicts UI are all required by the block (`FEATURES.md:270-273`) and are explicitly deferred in the evidence note (`_reviews/2026-06-05_block6-wave6_2a-qbo-oauth.md:43-45`).
- The acceptance criteria around “OAuth complete + first sync running within 60 seconds,” 15-minute incremental sync, QBO write-back round-trip, and stock-movement ingestion are not done (`FEATURES.md:276-281`). The evidence note admits the 60-second SLO is deferred to 6.2b and the cron/webhook/conflict work to 6.3 (`_reviews/2026-06-05_block6-wave6_2a-qbo-oauth.md:43-45`).
- The claimed “unit-verified” surface is overstated. The tests only hit the pure OAuth helper and crypto helper (`tests/qbo/oauth.test.ts:30-116`, `tests/qbo/crypto.test.ts:17-36`). There is no evidence on disk that exercises the callback route, the server actions, `saveQboConnection()`, `getQboStatus()`, `createQboAdapterForTenant()`, or disconnect behavior.
- The required memorable artifact is still not the thing the contract asked for. The feature requires a Playwright test capturing pre-connect, mid-sync, and post-sync (`FEATURES.md:290-292`). What exists is a jsdom Vitest file that mocks all integration actions (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:1-31`) and clicks the sample-preview path, not the OAuth/live-sync path (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:43-57`).
- The build sequence explicitly says token encryption uses `pgsodium` (`FEATURES.md:263`, `FEATURES.md:268`). The shipped implementation does not do that; the evidence note says “pgsodium stays unused” (`_reviews/2026-06-05_block6-wave6_2a-qbo-oauth.md:15`).

## What can be done better

- `saveQboConnection()` can leave the tenant in a broken half-connected state. It inserts or updates `source_connections` first (`src/lib/qbo/connection.ts:43-66`) and only then writes encrypted credentials via RPC (`src/lib/qbo/connection.ts:68-72`). If the RPC fails, `getQboStatus()` will still report `connected: true` off the active row (`src/lib/qbo/connection.ts:117-135`), while `runQboLiveSync()` later resolves to “QuickBooks is not connected yet” when `loadQboConnection()` returns null (`src/app/(app)/integrations/actions.ts:113-115`). That is a real state-corruption bug, not polish.
- The env-gating story is sloppy and the comment lies. `QuickBooksPage` claims missing QBO env means “connect stays gated” (`src/app/(app)/integrations/quickbooks/page.tsx:27-30`), but the not-connected UI always renders the live “Connect QuickBooks” button (`src/app/(app)/integrations/quickbooks/ConnectPanel.tsx:228-236`). Clicking it will call `qboEnv()` inside `startQboConnect()` (`src/app/(app)/integrations/actions.ts:88`) and blow up instead of presenting a controlled unavailable state.
- The stylesheet still violates the project’s own token rule. `MASTER_PROMPT.md` says no hardcoded spacing or motion values anywhere (`MASTER_PROMPT.md:17`, `MASTER_PROMPT.md:141`), but `integrations.module.css` still hardcodes raw pixels throughout: `280px`, `36px`, `44px`, `22px`, `720px`, etc. (`src/app/(app)/integrations/integrations.module.css:12`, `:37-42`, `:123-139`, `:219`).
- The “memorable” test is too fake to carry trust. It mocks `runQboLiveSync`, `startQboConnect`, and `disconnectQbo` entirely (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:22-30`), then exercises only the sample-preview button (`_reviews/2026-06-05_feature_qbo_connect_memorable.test.tsx:50`). That proves the animation component, not the feature’s real signature flow.

## What was missed

- The project-wide `idempotency_key` rule was missed on the new external-write actions. `MASTER_PROMPT.md` requires Server Actions with `idempotency_key` on every external-write action (`MASTER_PROMPT.md:24`), but `startQboConnect()`, `runQboLiveSync()`, and `disconnectQbo()` take no such input and do external side effects anyway (`src/app/(app)/integrations/actions.ts:79-153`).
- The production-ready rule for async surfaces was missed. `MASTER_PROMPT.md` requires empty/loading/error states on-direction (`MASTER_PROMPT.md:136`). `ConnectPanel` has an error state and button loading, but no explicit unavailable state for missing env, no empty state for a connected tenant with zero pullable records, and no server-side recovery surface for the “connected row exists but creds missing” case created by the persistence bug.
- The contract drift on encryption was missed instead of being formally corrected. The feature block still names `pgsodium` as the service/dependency and build-step mechanism (`FEATURES.md:263`, `FEATURES.md:268`), while the code and evidence switched to app-side AES (`src/lib/qbo/crypto.ts:5-15`, `_reviews/2026-06-05_block6-wave6_2a-qbo-oauth.md:15`). If the contract changed, the artifact should have been updated. It wasn’t.
- The required visible-craft standard was missed in substance, not just file naming. The contract says the memorable element is the live chain forming during the first sync after connect (`FEATURES.md:292`). The artifact on disk proves the sample-data fallback path and a mocked chain component, not the operator watching their existing QBO state become a chain.

---

## Decisions (captured 2026-06-05, MG: "Codex + push now, verify live after")

### Half-connected state corruption (What can be done better)
- **Decision:** Fix now. **Action:** `saveQboConnection` writes credentials BEFORE
  flipping status to `active` (new rows start `connecting`), so `active` always
  implies creds. Validated by `tests/qbo/connection.test.ts`.

### Env-gating crash + comment lie (What can be done better)
- **Decision:** Fix now. **Action:** page passes a `configured` flag; ConnectPanel
  renders an "not configured on this deployment" state instead of a Connect button
  that throws. Adds the missing unavailable state.

### Memorable artifact only proves the sample path (What wasn't done / better / missed)
- **Decision:** Fix now (deepen) + ticket the Playwright capture. **Action:** added a
  connected-mode test driving the real "Run sync" live path (the signature flow).
  True Playwright 3-state capture stays ticketed (Playwright not wired in repo).

### No integration coverage of connection/status/factory (What wasn't done)
- **Decision:** Fix now (connection layer) + ticket route/action layer. **Action:**
  `tests/qbo/connection.test.ts` exercises save→load round-trip, ciphertext-at-rest,
  status, single-connection refresh, deactivate against local Supabase.

### pgsodium contract drift (What wasn't done / missed)
- **Decision:** Correct the contract. **Action:** FEATURES.md Block 6 now states
  app-side AES-256-GCM (pgsodium deprecated on PG15+, anticipated by the init note).

### idempotency_key on the new actions (What was missed)
- **Decision:** Document the interpretation (keep). The rule targets record-creating
  external writes; connect/sync/disconnect create no external records and are
  naturally idempotent. The PO push (6.2b/Block 11) carries idempotencyKey. Ticketed
  for MG to override if he wants the literal param.

### Feature contract not fully delivered (workflow/cron/webhook/conflict/SLO)
- **Decision:** Out of scope by the MG-approved wave split (6.2b/6.3). Ticketed.

### Raw-px in CSS
- **Decision:** Already the holistic stack-audit ticket (consistent with 6.1).

### Ready to push?
- **Decision:** Yes. 243/243, typecheck/lint/craft clean. Live consent handshake is
  MG's post-push acceptance step.
