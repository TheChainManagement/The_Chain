'use server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getForecastInsight, getReorderInsight, type InsightResult } from './generate';

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

/**
 * Lazy "Why this forecast" loader (Block 12 Wave B). RLS existence check on the
 * product first, then the cached generation runs via the admin client (`insights`
 * is system-write). The insight is keyed on the SKU's latest forecast, so a
 * recompute regenerates it.
 */
export async function loadForecastInsight(productId: string): Promise<InsightResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .maybeSingle<{ id: string }>();
  if (!product) return { ok: false, error: 'That SKU was not found.' };

  return getForecastInsight(createSupabaseAdmin(), tenantId, productId);
}
