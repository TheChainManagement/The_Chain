'use server';

import { revalidatePath } from 'next/cache';
import { getPolicyWhatIfInsight, type InsightResult } from '@/lib/insights/generate';
import type { PolicyWhatIfFacts } from '@/lib/insights/prompts';
import { clampServiceLevel } from '@/lib/policy/compute';
import { COVERAGE_DAYS, derivePoliciesForRun } from '@/lib/policy/derive';
import { deriveScenario, loadWhatIfInputs } from '@/lib/policy/whatif';
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

/**
 * "Explain this what-if" (Block 12 Wave B3). Re-derives BOTH the saved baseline
 * and the scrubbed scenario server-side via the same pure `deriveScenario` the
 * bench runs, then hands Claude the before/after numbers to narrate the
 * trade-off. The model never sees a client-asserted figure — only engine output.
 * Read-only (no role gate): exploring trade-offs writes nothing.
 */
export async function explainWhatIf(input: {
  productId: string;
  locationId: string;
  serviceLevel: number;
  supplierId: string | null;
  leadOverride: number | null;
}): Promise<InsightResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const inputs = await loadWhatIfInputs(supabase, input.productId, COVERAGE_DAYS, input.locationId);
  if (!inputs) return { ok: false, error: 'No policy to explore for that SKU yet.' };

  const baseline = deriveScenario(inputs, {
    serviceLevel: inputs.serviceLevel,
    supplierId: inputs.primarySupplierId,
    leadOverride: null,
  });
  const scenario = deriveScenario(inputs, {
    serviceLevel: input.serviceLevel,
    supplierId: input.supplierId,
    leadOverride: input.leadOverride,
  });
  if (!baseline.policy || !scenario.policy) {
    return { ok: false, error: 'This scenario has no lead time to compute against.' };
  }

  const facts: PolicyWhatIfFacts = {
    sku: inputs.sku,
    supplierName: scenario.supplier?.name ?? 'the supplier',
    supplierChanged: input.supplierId !== inputs.primarySupplierId,
    baseServiceLevelPct: Math.round(inputs.serviceLevel * 1000) / 10,
    scenarioServiceLevelPct: Math.round(clampServiceLevel(input.serviceLevel) * 1000) / 10,
    baseLeadTimeDays: baseline.effectiveLead,
    scenarioLeadTimeDays: scenario.effectiveLead,
    baseSafetyStock: round1(baseline.policy.safetyStock),
    scenarioSafetyStock: round1(scenario.policy.safetyStock),
    baseReorderPoint: round1(baseline.policy.reorderPoint),
    scenarioReorderPoint: round1(scenario.policy.reorderPoint),
  };

  return getPolicyWhatIfInsight(
    createSupabaseAdmin(),
    tenantId,
    input.productId,
    input.locationId,
    facts,
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
