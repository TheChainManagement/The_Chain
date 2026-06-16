import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dashboard (Block 15) reads that aren't already covered by an existing read
 * model. Server-only; tenant fencing is RLS, so these never take a tenant_id.
 */

/** Rolling-30d OTIF per supplier (0..1), for the "most-used supplier" metric.
 *  Mirrors the scorecard read the reorder queue uses. */
export async function loadSupplierOtif(
  supabase: SupabaseClient,
): Promise<Map<string, number | null>> {
  const { data, error } = await supabase
    .from('supplier_scorecards')
    .select('supplier_id, otif_pct')
    .eq('window_kind', 'rolling_30d')
    .returns<{ supplier_id: string; otif_pct: number | string | null }[]>();
  if (error) throw new Error(`loadSupplierOtif failed: ${error.message}`);
  const map = new Map<string, number | null>();
  for (const row of data ?? []) {
    map.set(row.supplier_id, row.otif_pct == null ? null : Number(row.otif_pct));
  }
  return map;
}

/** Whether the tenant has any active catalog yet — distinguishes a truly fresh
 *  bench from one that's mid-onboarding (catalog imported, engine still forming
 *  the first recommendations). */
export async function countActiveProducts(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw new Error(`countActiveProducts failed: ${error.message}`);
  return count ?? 0;
}
