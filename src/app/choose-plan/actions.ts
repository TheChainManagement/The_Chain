'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCheckoutSession, createPortalSession } from '@/lib/billing/checkout';
import { requireMember } from '@/lib/billing/guard';
import { isPlanTier } from '@/lib/billing/plans';

/**
 * Gated billing actions (Block 16). Each verifies the authenticated user AND a
 * real current membership in the JWT's tenant (requireMember — same bar as the
 * bench) before touching Stripe, then redirects to the hosted Stripe page. Stripe
 * calls are wrapped so a provider error lands the user back on the picker with a
 * flag rather than an unhandled error (redirect() returns `never`, so the success
 * redirect is only reached when the call succeeded).
 */

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function startCheckout(formData: FormData): Promise<void> {
  const tier = String(formData.get('tier') ?? '');
  if (!isPlanTier(tier)) redirect('/choose-plan?error=invalid_plan');
  const { email, tenantId, role } = await requireMember();
  if (role !== 'owner') redirect('/choose-plan?error=permission');
  let url: string;
  try {
    url = await createCheckoutSession({ tenantId, userEmail: email, tier, origin: await origin() });
  } catch {
    redirect('/choose-plan?error=checkout');
  }
  redirect(url);
}

export async function startPortal(): Promise<void> {
  const { tenantId, role } = await requireMember();
  if (role !== 'owner') redirect('/settings/billing?error=permission');
  let url: string;
  try {
    url = await createPortalSession({ tenantId, origin: await origin() });
  } catch {
    redirect('/choose-plan?error=portal');
  }
  redirect(url);
}
