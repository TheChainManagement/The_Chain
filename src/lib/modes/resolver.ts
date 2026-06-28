import 'server-only';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getProfile } from './profiles';
import type { OperatingMode, OperatingProfile } from './types';

/**
 * Read a tenant's operating mode (W2-0). Mirrors loadSubscription: the read goes
 * through the service-role admin client, always scoped to a tenant_id the caller
 * was already verified to belong to (BenchGate membership check). operating_mode
 * is non-sensitive, but tenants-row RLS varies by role, so the admin read keeps
 * the layout uniform for every role. Both a read error AND a missing row throw:
 * BenchGate already verified membership, so an absent tenant row is corruption,
 * not a benign default — surfacing it beats silently rendering the wrong mode.
 */
export async function loadOperatingMode(tenantId: string): Promise<OperatingMode> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('tenants')
    .select('operating_mode')
    .eq('id', tenantId)
    .maybeSingle<{ operating_mode: OperatingMode }>();
  if (error) throw new Error(`loadOperatingMode failed: ${error.message}`);
  if (!data) throw new Error(`loadOperatingMode: no tenant row for ${tenantId}`);
  return data.operating_mode;
}

/** Load a tenant's resolved operating profile (mode key → declarative profile). */
export async function loadOperatingProfile(tenantId: string): Promise<OperatingProfile> {
  return getProfile(await loadOperatingMode(tenantId));
}
