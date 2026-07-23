'use server';

import { revalidatePath } from 'next/cache';
import { memberCanAccessEveryLocation, memberCanExecute } from '@/lib/access/location-access';
import { convertRecommendationsToPurchaseRequest } from '@/lib/reorder/convert';
import { type GenerateSummary, generateReorderRecommendations } from '@/lib/reorder/generate';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Reorder queue actions (Block 11).
 *
 * `recomputeReorders` regenerates recommendations. `submitSelectedPurchaseRequest`
 * submits a selected same-supplier set through the requisition policy spine.
 * Both run the engine via the admin client (system writes), authorized here.
 */

export type RecomputeResult = { ok: true; summary: GenerateSummary } | { ok: false; error: string };
export type ConvertActionResult =
  | { ok: true; destination: 'purchase_order'; poId: string; requisitionId: string }
  | { ok: true; destination: 'requisition'; requisitionId: string; reason: string }
  | { ok: false; error: string };

export async function recomputeReorders(
  _input: Record<string, never> = {},
): Promise<RecomputeResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const userId = data?.claims?.sub as string | undefined;

  if (!tenantId || !userId) return { ok: false, error: 'Your session expired. Sign in again.' };
  const admin = createSupabaseAdmin();
  if (!(await memberCanExecute(admin, tenantId, userId, 'reorder.recompute'))) {
    return { ok: false, error: 'Only an owner or manager can recompute the reorder queue.' };
  }

  try {
    const summary = await generateReorderRecommendations(admin, { tenantId });
    revalidatePath('/reorder');
    return { ok: true, summary };
  } catch {
    return { ok: false, error: 'Could not recompute the reorder queue. Please try again.' };
  }
}

export async function submitSelectedPurchaseRequest(input: {
  recommendationIds: string[];
}): Promise<ConvertActionResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const userId = data?.claims?.sub as string | undefined;

  if (!tenantId || !userId) return { ok: false, error: 'Your session expired. Sign in again.' };
  const admin = createSupabaseAdmin();
  if (!(await memberCanExecute(admin, tenantId, userId, 'purchase_order.create'))) {
    return { ok: false, error: 'You do not have permission to create purchase orders.' };
  }

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

  const result = await convertRecommendationsToPurchaseRequest(supabase, {
    tenantId,
    recommendationIds: input.recommendationIds,
  });
  if (!result.ok) return result;

  revalidatePath('/reorder');
  revalidatePath('/procurement');
  revalidatePath(`/procurement/requisitions/${result.requisitionId}`);
  if (!result.poId) {
    return {
      ok: true,
      destination: 'requisition',
      requisitionId: result.requisitionId,
      reason: result.reason,
    };
  }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${result.poId}`);
  return {
    ok: true,
    destination: 'purchase_order',
    poId: result.poId,
    requisitionId: result.requisitionId,
  };
}
