import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { mapStripeStatus } from '@/lib/billing/plans';
import { getStripe } from '@/lib/billing/stripe';
import { applyStripeSubscription, findTenantByCustomer } from '@/lib/billing/subscription';

/**
 * Stripe webhook (Block 16). Owns the subscription lifecycle: activation,
 * renewals, payment failures (past_due), and cancellations. Signature-verified
 * with STRIPE_WEBHOOK_SECRET against the RAW body (request.text()). Writes via the
 * service-role admin client (no user session in a webhook); the tenant is taken
 * from the Stripe object's metadata, with a customer-id fallback. Idempotent on
 * the tenant_id PK, so Stripe retries and the success-page reconcile never drift.
 */

function tenantFromSubscription(sub: Stripe.Subscription): string | undefined {
  return sub.metadata?.tenant_id || undefined;
}

async function resolveTenant(
  metaTenant: string | undefined,
  customerId: string | null,
): Promise<string | null> {
  if (metaTenant) return metaTenant;
  if (customerId) return findTenantByCustomer(customerId);
  return null;
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const stripe = getStripe();
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = customerIdOf(session.customer);
        const tenantId = await resolveTenant(
          session.client_reference_id ?? session.metadata?.tenant_id ?? undefined,
          customerId,
        );
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (tenantId && customerId && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applyStripeSubscription({
            tenantId,
            customerId,
            subscription: sub,
            status: mapStripeStatus(sub.status),
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = customerIdOf(sub.customer);
        const tenantId = await resolveTenant(tenantFromSubscription(sub), customerId);
        if (tenantId && customerId) {
          await applyStripeSubscription({
            tenantId,
            customerId,
            subscription: sub,
            status: mapStripeStatus(sub.status),
          });
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch {
    // A processing failure returns 500 so Stripe retries the delivery.
    return NextResponse.json({ error: 'processing error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
