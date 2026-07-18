'use server';

import { revalidatePath } from 'next/cache';
import { memberCanAccessEveryLocation } from '@/lib/access/location-access';
import { convertRecommendationsToPo } from '@/lib/reorder/convert';
import { type GenerateSummary, generateReorderRecommendations } from '@/lib/reorder/generate';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Reorder queue actions (Block 11).
 *
 * `recomputeReorders` — owner/manager regenerates recommendations from the
 * current policy + on-hand (the queue's "refresh"). `convertSelectedToPo` —
 * owner|manager|planner promotes a selected same-supplier set to a draft PO.
 * Both run the engine via the admin client (system writes), authorized here.
 */

const MANAGER = new Set(['owner', 'manager']);
const PLANNER = new Set(['owner', 'manager', 'planner']);

export type RecomputeResult = { ok: true; summary: GenerateSummary } | { ok: false; error: string };
export type ConvertActionResult = { ok: true; poId: string } | { ok: false; error: string };

export async function recomputeReorders(
  _input: Record<string, never> = {},
): Promise<RecomputeResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !MANAGER.has(role)) {
    return { ok: false, error: 'Only an owner or manager can recompute the reorder queue.' };
  }

  try {
    const summary = await generateReorderRecommendations(createSupabaseAdmin(), { tenantId });
    revalidatePath('/reorder');
    return { ok: true, summary };
  } catch {
    return { ok: false, error: 'Could not recompute the reorder queue. Please try again.' };
  }
}

export async function convertSelectedToPo(input: {
  recommendationIds: string[];
}): Promise<ConvertActionResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;
  const userId = data?.claims?.sub as string | undefined;

  if (!tenantId || !userId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PLANNER.has(role)) {
    return { ok: false, error: 'You do not have permission to create purchase orders.' };
  }

  const admin = createSupabaseAdmin();
  const { data: rows, error: rowsError } = await admin
    .from('reorder_recommendations')
    .select('location_id')
    .eq('tenant_id', tenantId)
    .in('id', input.recommendationIds);
  if (
    rowsError ||
    (rows?.length ?? 0) !== new Set(input.recommendationIds).size ||
    !(await memberCanAccessEveryLocation(
      admin,
      tenantId,
      userId,
      (rows ?? []).map((row) => row.location_id),
    ))
  ) {
    return { ok: false, error: 'One or more recommendations are outside your location access.' };
  }

  const result = await convertRecommendationsToPo(admin, {
    tenantId,
    recommendationIds: input.recommendationIds,
  });
  if (!result.ok) return result;

  revalidatePath('/reorder');
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${result.poId}`);
  return { ok: true, poId: result.poId };
}
