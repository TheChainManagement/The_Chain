import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Defense for service-role posting paths. RLS uses can_access_location(); these
 * paths bypass RLS by design, so they ask the same current-membership primitive
 * with an explicit actor before invoking a writer.
 */
export async function memberCanAccessLocation(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  locationId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('member_can_access_location', {
    p_tenant: tenantId,
    p_user: userId,
    p_location: locationId,
  });
  return !error && data === true;
}

export async function memberCanAccessEveryLocation(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  locationIds: string[],
): Promise<boolean> {
  const unique = [...new Set(locationIds)];
  if (unique.length === 0) return false;
  const results = await Promise.all(
    unique.map((locationId) => memberCanAccessLocation(admin, tenantId, userId, locationId)),
  );
  return results.every(Boolean);
}

export type MemberCapability = 'inventory.move' | 'reorder.recompute' | 'purchase_order.create';

/** Live role check for service-role write paths. Never trusts tenant_role. */
export async function memberCanExecute(
  admin: SupabaseClient,
  tenantId: string,
  userId: string,
  capability: MemberCapability,
): Promise<boolean> {
  const { data, error } = await admin.rpc('member_can_execute', {
    p_tenant: tenantId,
    p_user: userId,
    p_capability: capability,
  });
  return !error && data === true;
}
