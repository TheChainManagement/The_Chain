'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * W3-2 active-tenant switch. The RPC proves membership in the target tenant and
 * moves profiles.active_tenant_id; refreshing the session re-mints the tenant_id
 * and tenant_role claims from the access-token hook before the destination bench
 * renders. A failed switch (no membership) leaves the current context intact and
 * returns the user to the bench unchanged. Membership is enforced in the
 * database, not here.
 */
export async function switchActiveTenant(formData: FormData): Promise<void> {
  const tenantId = String(formData.get('tenant_id') ?? '');
  if (!tenantId) return;

  const supabase = await createSupabaseServer();
  const { error } = await supabase.rpc('switch_active_tenant', { p_tenant: tenantId });
  if (error) return;

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  const { data: claimsData } = await supabase.auth.getClaims(refreshed.session?.access_token);
  if (refreshError || !refreshed.session || claimsData?.claims?.tenant_id !== tenantId) {
    // Never render a destination bench under stale claims. The profile remains
    // on the membership-gated target; the next full sign-in will mint it cleanly.
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/signin?error=tenant_switch_refresh');
  }
  redirect('/today');
}
