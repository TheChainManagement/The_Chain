'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCheckoutSession, createPortalSession } from '@/lib/billing/checkout';
import { isPlanTier } from '@/lib/billing/plans';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Gated billing actions (Block 16). Each verifies the authenticated user + their
 * JWT tenant claim before touching Stripe, then redirects to the hosted Stripe
 * page. Stripe calls are wrapped so a provider error lands the user back on the
 * picker with a flag rather than an unhandled error (redirect() returns `never`,
 * so the success redirect is only reached when the call succeeded).
 */

async function authedTenant(): Promise<{ email: string | null; tenantId: string }> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  if (!tenantId) redirect('/signin');
  return { email: user.email ?? null, tenantId };
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function startCheckout(formData: FormData): Promise<void> {
  const tier = String(formData.get('tier') ?? '');
  if (!isPlanTier(tier)) redirect('/choose-plan?error=invalid_plan');
  const { email, tenantId } = await authedTenant();
  let url: string;
  try {
    url = await createCheckoutSession({ tenantId, userEmail: email, tier, origin: await origin() });
  } catch {
    redirect('/choose-plan?error=checkout');
  }
  redirect(url);
}

export async function startPortal(): Promise<void> {
  const { tenantId } = await authedTenant();
  let url: string;
  try {
    url = await createPortalSession({ tenantId, origin: await origin() });
  } catch {
    redirect('/choose-plan?error=portal');
  }
  redirect(url);
}
