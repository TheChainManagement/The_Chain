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

  await supabase.auth.refreshSession();
  redirect('/today');
}
