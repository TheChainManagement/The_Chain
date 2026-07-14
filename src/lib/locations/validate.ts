import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function isActiveTenantLocation(
  admin: SupabaseClient,
  tenantId: string,
  locationId: string,
): Promise<boolean> {
  if (!locationId) return false;
  const { data, error } = await admin
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', locationId)
    .eq('active', true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`Location validation failed: ${error.message}`);
  return Boolean(data);
}
