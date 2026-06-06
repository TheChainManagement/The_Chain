# Block 6 Wave 6.2a — live OAuth acceptance + callback Cache Components fix

**Date:** 2026-06-06
**Scope:** Bug fix surfaced during MG's live OAuth acceptance test for Wave 6.2a.

## What happened
Wave 6.2a (QBO live OAuth connect) was shipped 2026-06-05, but only OAuth
*initiation* had been verified (Connect → redirect to Intuit). MG's acceptance
step — completing the consent handshake against the real Intuit sandbox — was
still open. On running it this session, the callback returned **500**:

```
GET /api/qbo/oauth/callback 500
Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.
> export const dynamic = 'force-dynamic';   // src/app/api/qbo/oauth/callback/route.ts:18
```

Latent bug: the route had never been *executed* before, so the incompatibility
between `export const dynamic = 'force-dynamic'` and Next 16 Cache Components
(`cacheComponents: true` in `next.config.ts`) never fired. **This would also
have 500'd in production**, since prod has Cache Components enabled too.

## Fix
- Removed `export const dynamic = 'force-dynamic'` from the callback route. The
  handler reads `cookies()` + `searchParams`, so it is inherently dynamic with
  no directive needed. (`src/app/api/qbo/oauth/callback/route.ts`)
- Pinned `dev` script to port 3100 (`next dev -p 3100`) so `npm run dev` always
  matches `QBO_REDIRECT_URI=http://localhost:3100/api/qbo/oauth/callback`. Was
  previously started manually with `-p 3100`; default `next dev` (:3000) would
  break the redirect. (`package.json`)

## Verification (live, real Intuit sandbox)
- Redirect URI registered in Intuit Developer (Sandbox key set).
- Pre-fix callback: `GET /api/qbo/oauth/callback?error=access_denied` → **307**
  redirect to connect screen (graceful, no 500) — confirmed compile fix via curl.
- Full handshake: `startQboConnect()` → Intuit consent → callback with real
  `code` + `state` + `realmId=9341457226280805` → **307** (753ms app code:
  token exchange + AES-256-GCM encrypt + store) → `?connected=1` **200**.
- `runQboLiveSync()` → **200** in 5.5s (real QBO Query API round-trips).
- On-screen chain formed from real sandbox data:
  - Suppliers (vendors): **26**
  - Ordered: **3**
  - In transit (open): **1**
  - Catalog: **4** · Receipts: **2** · Sales: **63** · **Errors: 0**

## Gates
- typecheck: clean
- lint (biome): 119 files, clean
- Light gate only — single-line bug fix + dev-port pin; no Codex pass per the
  "don't force heavyweight gates on small contained diffs" rule.

## Note for prod
Production deploy carries the same latent callback bug until this push lands.
Prod QBO is not yet wired (no prod QBO_* env vars / prod redirect URI), so no
user could hit it, but the fix ships regardless. Prod QBO enablement remains
ticketed.
