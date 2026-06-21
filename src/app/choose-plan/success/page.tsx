import { redirect } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { requireMember } from '@/lib/billing/guard';
import { mapStripeStatus } from '@/lib/billing/plans';
import { getStripe } from '@/lib/billing/stripe';
import { applyStripeSubscription } from '@/lib/billing/subscription';

/**
 * Checkout return (Block 16). Reconciles the subscription synchronously from the
 * Checkout Session so access is granted the instant Stripe redirects back —
 * no dependence on webhook latency. Verifies the session's tenant matches the
 * signed-in tenant before activating (never activate someone else's tenant). The
 * webhook still owns the ongoing lifecycle (renewals, cancellations); both writes
 * are idempotent on the tenant_id PK.
 */
export default function CheckoutSuccess({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <CheckoutSuccessInner searchParams={searchParams} />
    </Suspense>
  );
}

async function CheckoutSuccessInner({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}): Promise<ReactNode> {
  const { tenantId } = await requireMember();

  const { session_id } = await searchParams;
  if (!session_id) redirect('/choose-plan');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });
    // Guard: the session must belong to THIS tenant.
    const sessionTenant = session.client_reference_id ?? session.metadata?.tenant_id;
    const sub = session.subscription;
    if (sessionTenant === tenantId && sub && typeof sub !== 'string') {
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      if (customerId) {
        await applyStripeSubscription({
          tenantId,
          customerId,
          subscription: sub,
          status: mapStripeStatus(sub.status),
        });
      }
    }
  } catch {
    // Reconciliation failed — the webhook will still activate. Fall through; the
    // bench paywall sends them back to /choose-plan if access isn't live yet.
  }

  redirect('/today');
}
