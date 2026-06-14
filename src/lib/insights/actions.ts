'use server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getReorderInsight, type InsightResult } from './generate';

/**
 * Lazy insight loader (Block 12). Called by the client panel on first view. RLS
 * existence check first (a caller only resolves their own entity), then the
 * cached generation runs via the admin client (`insights` is system-write).
 */
export async function loadReorderInsight(poId: string): Promise<InsightResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id')
    .eq('id', poId)
    .maybeSingle<{ id: string }>();
  if (!po) return { ok: false, error: 'That order was not found.' };

  return getReorderInsight(createSupabaseAdmin(), tenantId, poId);
}
