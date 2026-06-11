'use server';

import { revalidatePath } from 'next/cache';
import { classifyTenant } from '@/lib/classification/classify';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Recompute ABC/XYZ classification for the whole tenant catalog (Block 7).
 *
 * Owner/manager only (same gate as the QBO sync actions). Runs the classification
 * engine via the service-role admin client (the table is system-write-only), then
 * revalidates the surfaces that read it. Wave 1 runs synchronously in the action;
 * the Block 8 forecast batch will own the scheduled run and reuse the same engine.
 */

const PRIVILEGED = new Set(['owner', 'manager']);

export type RecomputeResult = { ok: true; classified: number } | { ok: false; error: string };

export async function recomputeClassifications(): Promise<RecomputeResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can recompute classification.' };
  }

  try {
    const admin = createSupabaseAdmin();
    const summary = await classifyTenant(admin, tenantId);
    revalidatePath('/inventory/classification');
    revalidatePath('/inventory');
    return { ok: true, classified: summary.classified };
  } catch {
    return { ok: false, error: 'Could not recompute classification. Please try again.' };
  }
}
