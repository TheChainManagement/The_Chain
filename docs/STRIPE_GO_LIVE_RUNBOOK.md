# The Chain — Stripe TEST → LIVE Go-Live Runbook

Prepared 2026-06-25. Do the flip itself with MG present and the Stripe dashboard open.
Prod currently runs Stripe in **TEST** mode and passed full E2E acceptance (2026-06-24).
Prod has **0 real tenants**, so rollback risk is low.

This runbook is grounded in the actual code:
- Webhook route: `src/app/api/webhooks/stripe/route.ts` → path **`/api/webhooks/stripe`**
- Env contract: `src/lib/env.ts` → `stripeEnv()` + the webhook reads `STRIPE_WEBHOOK_SECRET` directly
- Price seeder: `scripts/stripe-seed.mjs` (idempotent via `lookup_key`)
- Vercel project: `the-chain` (`prj_IaJsowGcCO2Qk1XeAqQws1RSFvVf`, team `team_Ch8Tgz4BJR8bNnbEoPJc7TUW`)

---

## 0. Pre-flight (do before flipping anything)

- [ ] Confirm the **production domain** that customers will hit. The intended prod domain is **`thechainmanagement.com`** (NOT `cmf.com` — that belongs to the CMF consulting firm). **As of 2026-06-27 this domain is NOT on Vercel yet** — it's registered and live but its DNS points at WordPress.com (`192.0.78.24/.25`). Before it can serve the app you must: (a) add `thechainmanagement.com` to the `the-chain` Vercel project (`vercel domains add` / project → Domains), and (b) repoint its DNS off WordPress.com to Vercel (A/CNAME or nameservers per Vercel's instructions). Until that's done, prod is `the-chain-five.vercel.app`. **Decide which host before registering the webhook** — if you register against the vercel.app host and later move to `thechainmanagement.com`, you re-register the Stripe (and QBO) webhook against the new host.
- [ ] Confirm Stripe account is in **business-activated** state (Stripe → Settings → Account: bank account + business details complete). Live charges fail without this.
- [ ] Have the current TEST env values copied somewhere safe — they're your rollback (Step 7).

---

## 1. Get LIVE keys from Stripe

Stripe dashboard → toggle **Test mode OFF** (top-right) → Developers → API keys.

- [ ] Copy the **live secret key** → `sk_live_...`
- [ ] (Publishable key `pk_live_...` is **not needed by the app** — we use Stripe Hosted Checkout, no client-side Stripe.js. `STRIPE_PUBLISHABLE_KEY` exists in `.env.local` but no code reads it. Skip it unless you want it set for consistency.)

---

## 2. Seed LIVE products/prices ($129 / $299 / $599 monthly)

The live price IDs are different objects from the test ones, so you need three new `price_...` IDs.

⚠️ **`scripts/stripe-seed.mjs` refuses any key that isn't `sk_test_`** (safety guard, line 23). Two options:

**Option A — manual (safest, recommended for the first live setup):**
In Stripe LIVE mode → Product catalog → create three products with one recurring monthly price each:
- Starter — **$129.00/mo USD**, set lookup key `chain_starter_monthly`
- Growth — **$299.00/mo USD**, set lookup key `chain_growth_monthly`
- Pro — **$599.00/mo USD**, set lookup key `chain_pro_monthly`
Copy each resulting `price_...` ID.

**Option B — scripted:** ask me to add an opt-in `ALLOW_LIVE_SEED=1` flag to the seeder (a no-money code change I can do before the session). Then `ALLOW_LIVE_SEED=1 node --env-file=.env.live scripts/stripe-seed.mjs` creates them and prints the env lines. Same amounts/lookup keys as Option A.

- [ ] Record the three live price IDs:
  - `STRIPE_PRICE_STARTER=price_...`
  - `STRIPE_PRICE_GROWTH=price_...`
  - `STRIPE_PRICE_PRO=price_...`

---

## 3. Configure the LIVE Customer Portal

The billing settings page calls `stripe.billingPortal.sessions.create(...)` (`src/lib/billing/checkout.ts:67`). The **Customer Portal must be activated separately in LIVE mode** — test-mode config does NOT carry over.

- [ ] Stripe LIVE → Settings → Billing → Customer portal → activate, allow plan switching + cancellation as desired, save.

---

## 4. Register the LIVE webhook endpoint

Stripe LIVE → Developers → Webhooks → Add endpoint.

- [ ] **Endpoint URL:** `https://<CONFIRMED-PROD-DOMAIN>/api/webhooks/stripe`
- [ ] **Events to send** (must match the route's `switch` exactly):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] After creating, copy the endpoint's **signing secret** → `whsec_...` (this is the LIVE `STRIPE_WEBHOOK_SECRET`, different from test).

---

## 5. Update Vercel PRODUCTION env vars

Vercel → the-chain → Settings → Environment Variables → **Production** scope. Replace these five values with the live equivalents:

| Var | New value |
|-----|-----------|
| `STRIPE_SECRET_KEY` | `sk_live_...` (Step 1) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from the **live** endpoint (Step 4) |
| `STRIPE_PRICE_STARTER` | live `price_...` (Step 2) |
| `STRIPE_PRICE_GROWTH` | live `price_...` (Step 2) |
| `STRIPE_PRICE_PRO` | live `price_...` (Step 2) |

- [ ] All five updated in **Production** scope (leave Preview/Dev on test keys so preview deploys never touch live money).

---

## 6. Redeploy + smoke test

Env var changes only take effect on a **new deployment**.

- [ ] Trigger a prod deploy. Note: `vercel deploy --prod` is broken locally (790MB Python venv exceeds the Lambda limit). Use **`git push`** (git integration auto-deploys) or **`vercel redeploy <prod-deployment-url>`** from the dashboard.
- [ ] Wait for the deploy to go READY.
- [ ] **Live smoke test with a REAL card** (small real charge, you can refund after):
  1. Sign up / sign in as a throwaway tenant on prod.
  2. Hit `/choose-plan`, pick **Starter**, complete Stripe hosted checkout with a real card.
  3. Confirm redirect to `/choose-plan/success` and that the paywall lifts into the app.
  4. Stripe LIVE → Webhooks → your endpoint → confirm `checkout.session.completed` + `customer.subscription.created` delivered **200**.
  5. Stripe LIVE → Payments → confirm the charge; subscription shows **active**.
  6. Open `/settings/billing` → "Manage billing" → confirm the **live** Customer Portal opens.
  7. **Refund** the test charge and cancel the sub in Stripe; confirm `customer.subscription.deleted` fires and access is revoked.
- [ ] Tear down the throwaway tenant. **Reminder from last teardown:** deleting a tenant fires the Block-14 audit trigger which re-inserts into `audit_log` mid-transaction — clear `audit_log` **last**.

---

## 7. Rollback (if anything looks wrong)

Fast and clean because prod has no real customers yet:
- [ ] Restore the five Production env vars to their saved TEST values (Step 0).
- [ ] Redeploy (git push / redeploy).
- [ ] Optionally disable the live webhook endpoint in Stripe.
Result: prod is back on Stripe TEST, no live charges possible.

---

## Quick reference — what changes between TEST and LIVE

| Thing | Test (now) | Live (after flip) |
|-------|-----------|-------------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | test endpoint `whsec_...` | **live** endpoint `whsec_...` |
| 3× `STRIPE_PRICE_*` | test price IDs | **live** price IDs (new objects) |
| Webhook endpoint | test-mode endpoint | live-mode endpoint, same path/events |
| Customer Portal | test config | **separate** live config |
| Code / commits | — | **none** — flip is 100% config |

The flip touches **no application code**. Everything is Stripe dashboard + Vercel env + one redeploy.
