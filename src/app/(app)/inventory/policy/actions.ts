'use server';

import { revalidatePath } from 'next/cache';
import { clampServiceLevel } from '@/lib/policy/compute';
import { derivePoliciesForRun } from '@/lib/policy/derive';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * "Save as default" (Block 9 what-if bench). The ONLY write path out of the
 * bench: commits the chosen service level, then reruns the SAME derivation
 * engine the batch uses (it reads the saved level), so the stored policy is
 * always the engine's output — never a client-computed number. Scrubbing the
 * levers writes nothing; this action is the explicit commit.
 *
 * Owner/manager gate (parity with recomputeForecast — policy is a
 * money-adjacent default).
 */

const PRIVILEGED = new Set(['owner', 'manager']);

export type SavePolicyResult = { ok: true } | { ok: false; error: string };

export async function savePolicyDefault(input: {
  productId: string;
  locationId: string;
  serviceLevel: number;
}): Promise<SavePolicyResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can save policy defaults.' };
  }

  // RLS-scoped existence check + the backing forecast's run (the derivation
  // engine is scoped per run).
  const { data: policy } = await supabase
    .from('inventory_policy')
    .select('product_id, location_id, based_on_forecast_id, forecasts ( run_id )')
    .eq('product_id', input.productId)
    .eq('location_id', input.locationId)
    .maybeSingle<{
      product_id: string;
      location_id: string;
      based_on_forecast_id: string | null;
      forecasts: { run_id: string } | null;
    }>();
  if (!policy?.forecasts?.run_id) {
    return { ok: false, error: 'No policy to save for that SKU yet.' };
  }

  const admin = createSupabaseAdmin();
  const serviceLevel = clampServiceLevel(input.serviceLevel);

  const { error } = await admin
    .from('inventory_policy')
    .update({ service_level: serviceLevel })
    .eq('tenant_id', tenantId)
    .eq('product_id', input.productId)
    .eq('location_id', input.locationId);
  if (error) return { ok: false, error: 'Could not save the policy default.' };

  try {
    await derivePoliciesForRun(admin, {
      tenantId,
      runId: policy.forecasts.run_id,
      productIds: [input.productId],
    });
  } catch {
    return { ok: false, error: 'Saved the level, but the recompute failed. Try again.' };
  }

  revalidatePath('/inventory/policy');
  revalidatePath(`/inventory/${input.productId}`);
  return { ok: true };
}
