import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve an untrusted URL location into the caller tenant's active set.
 * Null means All locations. Invalid, archived, and cross-tenant UUIDs fall
 * back to All locations without ever widening the RLS boundary.
 */
export async function resolveLocationScope(
  supabase: SupabaseClient,
  raw: string | undefined,
): Promise<string | null> {
  if (!raw) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return null;
  }
  const { data, error } = await supabase
    .from('locations')
    .select('id')
    .eq('id', raw)
    .eq('active', true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`resolveLocationScope failed: ${error.message}`);
  return data?.id ?? null;
}
