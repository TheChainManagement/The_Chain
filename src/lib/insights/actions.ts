'use server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import {
  getForecastInsight,
  getReorderInsight,
  getWeeklyChangeInsight,
  type InsightResult,
  weeklyPeriodId,
} from './generate';

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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Lazy "What changed this week" digest loader (Block 12 Wave B2). Tenant-level —
 * no entity to existence-check, the tenant claim IS the scope. The window is the
 * trailing 7 days; the cache key is today's date so the note regenerates daily
 * as the window rolls forward (one cheap call per day, served from cache after).
 */
export async function loadWeeklyChangeInsight(): Promise<InsightResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const now = Date.now();
  const since = new Date(now - WEEK_MS).toISOString();
  const periodKey = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

  return getWeeklyChangeInsight(createSupabaseAdmin(), tenantId, weeklyPeriodId(periodKey), since);
}
