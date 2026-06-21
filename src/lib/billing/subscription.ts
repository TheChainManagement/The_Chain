import 'server-only';
import type Stripe from 'stripe';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { type AppSubStatus, priceIdToTier, retentionForTier } from './plans';
import { priceMap } from './stripe';

/**
 * Billing row reads/writes (Block 16). The `subscriptions` table is RLS-readable
 * only by owner/finance, but the PAYWALL must check access for EVERY role — so
 * these go through the service-role admin client, always scoped to a tenant_id
 * the caller was already verified to belong to (BenchGate membership check, or a
 * Stripe-signed webhook). There is no RLS net on this path by design.
 */

export interface SubscriptionRow {
  status: AppSubStatus;
  plan_code: string | null;
  retention_tier: string;
  billing_customer_id: string | null;
}

export async function loadSubscription(tenantId: string): Promise<SubscriptionRow | null> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('subscriptions')
    .select('status, plan_code, retention_tier, billing_customer_id')
    .eq('tenant_id', tenantId)
    .maybeSingle<SubscriptionRow>();
  // A read failure must not read as "no subscription" — that would silently let
  // the paywall fall open/closed on a transient DB error. Surface it.
  if (error) throw new Error(`loadSubscription failed: ${error.message}`);
  return data ?? null;
}

/**
 * Apply a Stripe subscription's state to our row. Idempotent: keyed on the
 * tenant_id PK (the row exists from signup), so the webhook and the success-page
 * reconciliation can both run without drift. Only sets the retention tier when the
 * price resolves to a known plan (otherwise the existing window is left intact).
 */
export async function applyStripeSubscription(params: {
  tenantId: string;
  customerId: string;
  subscription: Stripe.Subscription;
  status: AppSubStatus;
}): Promise<void> {
  const { tenantId, customerId, subscription, status } = params;
  const admin = createSupabaseAdmin();
  const priceId = subscription.items.data[0]?.price.id;
  const tier = priceIdToTier(priceId, priceMap());

  const update: Record<string, unknown> = {
    status,
    billing_customer_id: customerId,
    billing_provider: 'stripe',
  };
  if (tier) {
    update.plan_code = tier;
    update.retention_tier = retentionForTier(tier);
  }

  const { error } = await admin.from('subscriptions').update(update).eq('tenant_id', tenantId);
  // Throw on a failed write so the webhook returns 500 (Stripe retries) and the
  // success page doesn't redirect as if activation succeeded. No silent billing.
  if (error) throw new Error(`applyStripeSubscription failed: ${error.message}`);
}

/** Persist the Stripe customer id on a tenant's row (set once at checkout). */
export async function setBillingCustomer(tenantId: string, customerId: string): Promise<void> {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('subscriptions')
    .update({ billing_customer_id: customerId, billing_provider: 'stripe' })
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`setBillingCustomer failed: ${error.message}`);
}

/**
 * Resolve a tenant from its Stripe customer id (webhook fallback when an event's
 * metadata is missing the tenant_id — e.g. portal-initiated changes).
 */
export async function findTenantByCustomer(customerId: string): Promise<string | null> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('billing_customer_id', customerId)
    .maybeSingle<{ tenant_id: string }>();
  if (error) throw new Error(`findTenantByCustomer failed: ${error.message}`);
  return data?.tenant_id ?? null;
}
