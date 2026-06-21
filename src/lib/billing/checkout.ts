import 'server-only';
import type { PlanTier } from './plans';
import { getStripe, priceMap } from './stripe';
import { loadSubscription, setBillingCustomer } from './subscription';

/**
 * Checkout + Customer Portal sessions (Block 16). Hosted Checkout (redirect), so
 * there's no client Stripe.js. Each tenant maps to exactly one Stripe customer,
 * reused across checkouts and the portal; the id is stored on the subscriptions
 * row the first time. `allow_promotion_codes` is on so MG can hand out discount
 * codes (e.g. first-month 50%) created in the dashboard with no code change here.
 */

async function getOrCreateCustomer(params: {
  tenantId: string;
  userEmail: string | null;
}): Promise<string> {
  const { tenantId, userEmail } = params;
  const existing = await loadSubscription(tenantId);
  if (existing?.billing_customer_id) return existing.billing_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: userEmail ?? undefined,
    metadata: { tenant_id: tenantId, app: 'the-chain' },
  });
  await setBillingCustomer(tenantId, customer.id);
  return customer.id;
}

export async function createCheckoutSession(params: {
  tenantId: string;
  userEmail: string | null;
  tier: PlanTier;
  origin: string;
}): Promise<string> {
  const { tenantId, userEmail, tier, origin } = params;
  const stripe = getStripe();
  const customer = await getOrCreateCustomer({ tenantId, userEmail });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: priceMap()[tier], quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: tenantId,
    subscription_data: { metadata: { tenant_id: tenantId, tier } },
    metadata: { tenant_id: tenantId, tier },
    success_url: `${origin}/choose-plan/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/choose-plan?canceled=1`,
  });

  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

export async function createPortalSession(params: {
  tenantId: string;
  origin: string;
}): Promise<string> {
  const { tenantId, origin } = params;
  const sub = await loadSubscription(tenantId);
  if (!sub?.billing_customer_id) {
    throw new Error('No billing customer for this tenant yet');
  }
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.billing_customer_id,
    return_url: `${origin}/settings/billing`,
  });
  return session.url;
}
