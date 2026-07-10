'use server';

import { revalidatePath } from 'next/cache';
import { runForecastBatch } from '@/app/(app)/forecasts/actions';
import { mapWriteError, PERMISSION_MESSAGE, validateProductInput } from '@/lib/inventory/transform';
import type { OnboardingPath } from '@/lib/onboarding/state';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { mapSupplierWriteError, validateSupplierInput } from '@/lib/suppliers/transform';

/**
 * Onboarding mutations (Block 2, Wave 2a — fresh path + shell).
 *
 * Each step writes through the RLS tenant client (onboarding_state insert/update
 * is owner|manager per the Foundation policy) and stamps the matching
 * `onboarding_state.*_minimum_met_at`. The chain reads those stamps (plus live
 * counts) to light each link. Validation + write-error mapping reuse the pure
 * Block 3/4 transforms so the rules can't drift from /inventory and /suppliers.
 *
 * Completion kicks the existing forecastTenantBatchWorkflow (reuse, not a new
 * orchestrator); `finishOnboarding` stamps completed_at once the first forecast
 * lands. The seed-only bypass is the only way past the minimums and it is
 * audit-logged via the admin client (audit_log has no tenant insert policy).
 */

const PRIVILEGED = new Set(['owner', 'manager']);

type Server = Awaited<ReturnType<typeof createSupabaseServer>>;

interface Claims {
  tenantId: string | null;
  role: string | null;
  userId: string | null;
}

async function resolveClaims(supabase: Server): Promise<Claims> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  return {
    tenantId: (claims?.tenant_id as string | undefined) ?? null,
    role: (claims?.tenant_role as string | undefined) ?? null,
    userId: (claims?.sub as string | undefined) ?? null,
  };
}

export type PathState = { ok: true; path: OnboardingPath } | { ok: false; error: string };

/**
 * Choose an onboarding path. Upserts the onboarding_state row (created here, not
 * at sign-up, since the path isn't known until now). A `fresh` greenfield tenant
 * has no external source, so picking it also clears the Source link.
 */
export async function pickPath(path: OnboardingPath): Promise<PathState> {
  if (path !== 'qbo' && path !== 'csv' && path !== 'fresh') {
    return { ok: false, error: 'Pick one of the three paths.' };
  }

  const supabase = await createSupabaseServer();
  const { tenantId, role } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can set up the workshop.' };
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('onboarding_state').upsert(
    {
      tenant_id: tenantId,
      path,
      // Greenfield has no external source — picking "fresh" IS the source choice.
      source_connected_at: path === 'fresh' ? nowIso : null,
    },
    { onConflict: 'tenant_id' },
  );

  if (error) {
    return { ok: false, error: mapWriteError(error.code, error.message) };
  }

  revalidatePath('/onboarding');
  return { ok: true, path };
}

export type StepActionState = { ok: true } | { ok: false; error: string } | null;

/**
 * Fresh path step 1: the first product. One atomic RPC creates the SKU, provisions
 * the "Main" location, seeds the opening on-hand level, and stamps
 * catalog_minimum_met_at — so a mid-step failure can never leave a partial tenant
 * ("no partial-state" acceptance rule). Validation stays pure (Block 3 transform).
 */
export async function createFirstProduct(
  _prev: StepActionState,
  formData: FormData,
): Promise<StepActionState> {
  const sku = String(formData.get('sku') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const unitOfMeasure = String(formData.get('unit_of_measure') ?? '').trim();
  const onHandRaw = String(formData.get('on_hand') ?? '').trim();

  const valid = validateProductInput({ sku, name }, true);
  if (!valid.ok) return valid;

  const onHand = onHandRaw ? Number(onHandRaw) : 0;
  if (!Number.isFinite(onHand) || onHand < 0) {
    return { ok: false, error: 'Opening quantity must be zero or a positive number.' };
  }

  const supabase = await createSupabaseServer();
  const { tenantId, role } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) return { ok: false, error: PERMISSION_MESSAGE };

  // W2-2.5: the seed posts the opening on-hand through the posting kernel, so
  // the RPC runs under the service-role client (the role gate above is the
  // authorization) and takes the verified tenant explicitly.
  const admin = createSupabaseAdmin();
  const { error } = await admin.rpc('onboarding_seed_first_product', {
    p_tenant: tenantId,
    p_sku: sku,
    p_name: name,
    p_unit_of_measure: unitOfMeasure,
    p_on_hand: onHand,
  });
  if (error) {
    return { ok: false, error: mapWriteError(error.code, error.message) };
  }

  revalidatePath('/onboarding');
  return { ok: true };
}

/**
 * Fresh path step 2: the first supplier. One atomic RPC inserts the supplier,
 * links it as primary to the first product (the source-of-supply edge the engine
 * needs), and stamps suppliers_minimum_met_at — rolling back as a unit on failure.
 * The RPC raises if no product exists, so the supplier minimum can't clear on a
 * broken edge. Validation stays pure (Block 4 transform).
 */
export async function createFirstSupplier(
  _prev: StepActionState,
  formData: FormData,
): Promise<StepActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const leadTime = String(formData.get('default_lead_time_days') ?? '');

  const valid = validateSupplierInput({ name, defaultLeadTimeDays: leadTime });
  if (!valid.ok) return valid;

  const supabase = await createSupabaseServer();
  const { tenantId, role } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) return { ok: false, error: PERMISSION_MESSAGE };

  const leadDays = leadTime.trim() ? Math.trunc(Number(leadTime)) : null;
  const { error } = await supabase.rpc('onboarding_seed_first_supplier', {
    p_name: name,
    p_lead_time_days: leadDays,
  });
  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }

  revalidatePath('/onboarding');
  return { ok: true };
}

export type CompleteState = { ok: true; trackingKey: string } | { ok: false; error: string };

/**
 * Kick the first forecast batch (reuses runForecastBatch → the durable
 * forecastTenantBatchWorkflow). The client polls getForecastBatchProgress and
 * calls finishOnboarding once it completes. Guarded on the minimums having been
 * met, so completion can't be reached with an empty catalog.
 */
export async function completeOnboarding(): Promise<CompleteState> {
  const supabase = await createSupabaseServer();
  const { tenantId } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const [{ count: productCount }, { count: supplierCount }] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);
  if (!productCount || !supplierCount) {
    return { ok: false, error: 'Add at least one product and one supplier first.' };
  }

  return runForecastBatch();
}

/**
 * Stamp completed_at once the first forecast has landed. Verifies the batch
 * actually produced a forecast-ready signal so completion reflects real state,
 * not just an optimistic client. Idempotent.
 */
export async function finishOnboarding(): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServer();
  const { tenantId } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false };

  const { data: state } = await supabase
    .from('onboarding_state')
    .select('first_forecast_ready_at, completed_at')
    .maybeSingle<{ first_forecast_ready_at: string | null; completed_at: string | null }>();

  if (state?.completed_at) return { ok: true };
  if (!state?.first_forecast_ready_at) return { ok: false };

  await supabase
    .from('onboarding_state')
    .update({ completed_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .is('completed_at', null);

  revalidatePath('/today');
  return { ok: true };
}

export type BypassState = { ok: true } | { ok: false; error: string };

/**
 * Seed-only opt-in: the only way past the minimums. An explicit, owner-gated,
 * audit-logged bypass (acceptance criterion). Marks the flag, completes
 * onboarding, and writes the bypass to audit_log via the admin client (audit_log
 * has no tenant insert policy — system-writes only).
 */
export async function seedOnlyOptIn(): Promise<BypassState> {
  const supabase = await createSupabaseServer();
  const { tenantId, role, userId } = await resolveClaims(supabase);
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (role !== 'owner') {
    return { ok: false, error: 'Only the owner can skip setup.' };
  }

  const nowIso = new Date().toISOString();

  // A user can skip BEFORE choosing a path, so the onboarding_state row may not
  // exist yet — upsert (not update) so completion always lands. path is NOT NULL;
  // preserve a chosen path, else default to 'fresh' (the greenfield default).
  const { data: existing } = await supabase
    .from('onboarding_state')
    .select('path')
    .maybeSingle<{ path: OnboardingPath | null }>();

  const { error } = await supabase.from('onboarding_state').upsert(
    {
      tenant_id: tenantId,
      path: existing?.path ?? 'fresh',
      seed_only_opt_in: true,
      completed_at: nowIso,
    },
    { onConflict: 'tenant_id' },
  );
  if (error) {
    return { ok: false, error: mapWriteError(error.code, error.message) };
  }

  const admin = createSupabaseAdmin();
  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor_user_id: userId,
    entity_type: 'onboarding_state',
    entity_id: null,
    action: 'onboarding.seed_only_bypass',
    after: { seed_only_opt_in: true, completed_at: nowIso },
  });

  revalidatePath('/today');
  return { ok: true };
}
