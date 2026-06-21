# Block 16 — Subscription / billing (hard paywall, Stripe)

**Decision (MG 2026-06-21):** NO free trial. Hard paywall — sign up → pick a tier
→ pay → access. Self-serve Starter/Growth/Pro; Enterprise is contact-only.
Discounts later via Stripe promo codes (field already enabled). Stripe activated
now (the only reason it was deferred was pricing not being locked — it now is).

## Wave A — trial copy sweep (committed earlier, `0a92048`)
All "Start 14-day trial" → "Get started"; `TrialCta`→`GetStartedCta`; event
`trial_start_clicked`→`get_started_clicked`. Dropped free-trial/no-card framing
from pricing/signup/CTA band. Enterprise tier CTA → "Contact us" (/contact).

## Wave B — Stripe billing (this commit)
**Stripe account:** "The Chain sandbox" (`acct_1TktEG…`), TEST mode. Products +
prices seeded idempotently by `scripts/stripe-seed.mjs` (Starter $129 / Growth
$299 / Pro $599, monthly, lookup_keys `chain_*_monthly`). Price IDs in `.env.local`.

- **Schema:** added `incomplete` to `subscription_status`; `bootstrap_tenant`
  now creates an `incomplete` (unpaid, no-access) subscription instead of a trial.
  Applied to local DB. (Hosted migration + Vercel env = deploy-time steps.)
- **lib/billing:** `plans.ts` (pure: tiers, retention map, `hasAppAccess`,
  `mapStripeStatus`, `priceIdToTier` — 6 unit tests), `stripe.ts` (lazy client +
  env price map), `subscription.ts` (admin reads/writes — RLS lets only
  owner/finance read subs, but the paywall must hold for every role, so reads go
  through the service-role client, tenant-scoped after the membership check),
  `checkout.ts` (hosted Checkout + Customer Portal, one customer per tenant,
  `allow_promotion_codes` on).
- **Paywall:** `BenchGate` ((app)/layout) now redirects any member without
  `active`/`comp` to `/choose-plan`.
- **/choose-plan:** gated plan picker (auth-only, not behind the bench paywall).
  3 tiers → Checkout; Enterprise → contact; existing customers (past_due/canceled)
  get Manage-billing (portal). Suspense-wrapped per Next 16 cacheComponents.
- **/choose-plan/success:** reconciles the subscription synchronously from the
  Checkout Session (no webhook-lag race), tenant-guarded, then → /today.
- **/api/webhooks/stripe:** signature-verified (raw body), service-role writes,
  handles checkout.session.completed + customer.subscription.created/updated/
  deleted; idempotent on tenant_id; metadata tenant with customer-id fallback.
- **/settings/billing:** plan + status + retained-history + Manage-billing portal.

## Verification (live, Stripe test mode)
- ✅ Key + account confirmed ("The Chain sandbox", livemode=false).
- ✅ Checkout session creation: real `cs_test`, $299.00, promo codes on, host
  checkout.stripe.com.
- ✅ **Browser:** fresh signup (`paywall-test@thechain.test`) → bootstrap creates
  `incomplete` → /today **paywalled to /choose-plan**. Picker renders (3 tiers).
- ✅ "Get Growth" server action created a real session for the tenant
  (metadata tenant + tier=growth + $299). (Preview's sandbox won't follow the
  cross-origin redirect to Stripe; session creation confirmed via API.)
- ✅ **Webhook end-to-end:** created an active test subscription (pm_card_visa),
  POSTed a signed `customer.subscription.created` → webhook `200` → DB row
  `active / growth / standard / customer set`.
- ✅ **Paywall opens:** the now-active user reaches the app (`/onboarding`), no
  longer bounced to /choose-plan.
- ✅ typecheck clean · biome clean · craft PASS · **661 tests** · build clean (44
  routes incl. /choose-plan, /choose-plan/success, /settings/billing, webhook).

## Open / next
- **MG acceptance:** one real test-card checkout (4242 4242 4242 4242) on the
  hosted page → confirm success-page reconcile lands you in the app (same pattern
  as the QBO OAuth handshake acceptance).
- **Webhook secret:** local — `stripe listen --api-key $STRIPE_SECRET_KEY
  --forward-to localhost:3100/api/webhooks/stripe` (CLI defaults to the "More"
  account, so --api-key is required). Empty = route fails closed; success-page
  reconcile still activates checkouts.
- **Codex gate** before merging Block 16 (billing = high stakes).
- **Deploy-time:** apply both migrations to hosted Supabase; set Stripe env in
  Vercel (live keys + a dashboard webhook endpoint secret) when going live.
- Throwaway: local `paywall-test` tenant + Stripe test customer/sub (harmless,
  test mode / wiped on db reset).
