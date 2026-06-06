# Block 6 Wave 6.2a — QBO live OAuth connect + real-data chain

**Date:** 2026-06-05
**Scope:** Phase 6, Tranche B, Block 6 (QuickBooks Online), Wave 6.2a.
**Status:** BUILT + unit-verified + OAuth-initiation-verified. Live consent handshake is an MG-driven acceptance step (needs his Intuit login).

## What this wave is

Wave 6.2 splits into 6.2a (this — the OAuth handshake + connection + real-data read-only chain) and 6.2b (the durable `qboInitialSyncWorkflow` that writes pulled data into products/suppliers/movements). 6.2a establishes a real, encrypted connection and lets the operator watch the chain form from their actual QuickBooks data, read-only.

## Built

### OAuth + crypto + connection (`src/lib/qbo/`)
- **`oauth.ts`** — endpoints confirmed from Intuit's OpenID discovery doc (authorize `appcenter.intuit.com/connect/oauth2`, token `oauth.platform.intuit.com/oauth2/v1/tokens/bearer`, revoke `developer.api.intuit.com/v2/oauth2/tokens/revoke`). `buildAuthorizeUrl`, `exchangeAuthCode`, `refreshAccessToken`, `revokeToken` over an injectable `TokenHttp` seam. 429/5xx → RetryableError, other non-2xx → FatalError(oauth). Tokens never logged.
- **`crypto.ts`** — app-side AES-256-GCM (`QBO_TOKEN_ENC_KEY`, base64 32 bytes). Stores base64(iv|tag|ciphertext); GCM tag detects tamper. This is the encryption-at-rest the init migration deferred ("when QBO OAuth lands"); pgsodium stays unused.
- **`connection.ts`** — `saveQboConnection` (upsert + encrypted creds via RPC), `loadQboConnection` (decrypt), `getQboStatus` (RLS read for UI), `markConnectionSynced`, `deactivateQboConnection`. All writes through the service-role admin client, authorized at the gate.
- **`factory.ts`** — `createQboAdapterForTenant`: loads the connection, refreshes the access token within a 120s skew window (persisting rotated tokens), returns a ready `QboSourceAdapter`. Token read lazily so a mid-flight refresh is picked up.
- **`summary.ts`** — shared `summarizeQboPull(adapter)` (drain + counts) used by BOTH the sandbox preview and the live sync, so they render the same shape from the same code (removed the duplication).

### Migration
- `20260605120000_block6_qbo_connection.sql` — `set_qbo_credentials` / `get_qbo_credentials` bridge bytea<->base64 (supabase-js can't round-trip bytea). `security invoker`, execute revoked from public/authenticated, granted to service_role only.

### Routes + actions + UI
- **`/api/qbo/oauth/callback`** (route handler) — CSRF state-cookie verify, tenant + owner/manager check from session, code exchange, save connection, redirect with status flag. `force-dynamic`. Logs failure shape (no PII).
- **`integrations/actions.ts`** — `startQboConnect` (owner/manager; sets state cookie; returns authorize URL), `runQboLiveSync` (real read-only pull + counts + last_synced stamp), `runQboSandboxSync` (refactored onto the shared summary), `disconnectQbo` (best-effort revoke + deactivate). Error catch maps the taxonomy (rate-limit / reconnect / generic).
- **`ConnectPanel`** — two modes off server-resolved status. Not-connected: Connect (OAuth) + sample preview. Connected: status line, Run sync (real chain), Disconnect. Status banner from the callback's `?connected=1` / `?qbo_error=` flag.
- **`env.ts`** — lazy `qboEnv()` (5 vars). `.env.example` documented; `.env.local` filled (gitignored).

## Verification

- **Typecheck / lint / craft:** clean.
- **Tests: 237/237** (+11 — `tests/qbo/oauth.test.ts`: authorize URL, code exchange w/ Basic auth + grant body, 401→oauth, 429→retry, missing-tokens→fatal, refresh, revoke tolerance; `tests/qbo/crypto.test.ts`: round-trip, fresh IV, tamper rejection, short-blob rejection).
- **Live (localhost:3100, `qbo61-verify@thechain.test`):**
  - Not-connected UI renders Connect + sample-preview CTAs.
  - **Connect** → `startQboConnect` action returns `200` (verified in the network log) and the button enters the redirect to Intuit; the preview sandbox blocks the cross-origin hop, but initiation is correct (env loaded, role gated, state cookie set, valid authorize URL built).
  - Sample preview still forms the chain (4 vendors · 2 orders · 1 open · CATALOG 5 / RECEIPTS 3 / SALES 3 / ERRORS 0) — the shared-summary refactor didn't regress Wave 6.1.
  - Migration applied to the local stack (`supabase migration up`).
  - Evidence of record: a11y/DOM assertions + network log + the inline screenshot (preview_screenshot does NOT write PNG to disk in this env).

## MG acceptance step (the live handshake)
Only MG can complete Intuit consent (needs his sandbox login). In his Chrome: open `http://localhost:3100/integrations/quickbooks`, sign into The Chain, Connect QuickBooks, approve → lands "Connected" → Run sync forms the chain from real sandbox data. Requires `http://localhost:3100/api/qbo/oauth/callback` registered under Keys & OAuth.

## Deferred → Wave 6.2b / 6.3 (tracked in `_reviews/_tickets.md`)
- **6.2b:** `qboInitialSyncWorkflow` durable run writing pulled QBO data into products/suppliers/stock_movements (reusing the Block 5 commit core); the 60-second OAuth→first-sync SLO measured on Vercel Preview.
- **6.3:** incremental sync (15-min cron in `vercel.ts` + Intuit webhook w/ signature verify), conflict policy + `/flow/sync-conflicts`.
- **Pending infra:** production Vercel env vars (QBO_* + TOKEN_ENC_KEY) + production redirect URI registration (for live prod use); hosted Supabase migration apply (this push).
