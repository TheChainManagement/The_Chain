'use server';

import { revalidatePath } from 'next/cache';
import {
  type ConflictEntityType,
  planConflictResolution,
  type ResolutionChoice,
} from '@/lib/qbo/resolve';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Resolve one `needs_review` sync conflict (Block 6, Wave 6.3-C).
 *
 * An owner/manager picks accept_local / accept_remote / merge on the
 * `/flow/sync-conflicts` cockpit. The choice runs through the pure
 * `planConflictResolution` planner, then we:
 *   - write the chosen QBO-owned field values onto the entity (skipped for
 *     accept_local — the local row already wins),
 *   - stamp `external_ids.qbo_fp` with the adjudicated remote fingerprint so the
 *     next incremental sync does NOT re-flag the same remote change, and
 *   - mark the conflict resolved (who + when).
 *
 * Service-role writes (the entity update bypasses per-row RLS), gated by an
 * explicit owner/manager role check — same pattern as `runQboIncrementalSync`.
 */

const PRIVILEGED = new Set(['owner', 'manager']);

export interface ResolveConflictInput {
  conflictId: string;
  resolution: ResolutionChoice;
  mergePayload?: Record<string, unknown> | null;
}

export type ResolveConflictResult = { ok: true } | { ok: false; error: string };

export async function resolveSyncConflict(
  input: ResolveConflictInput,
): Promise<ResolveConflictResult> {
  const { conflictId, resolution, mergePayload } = input;
  const supabase = await createSupabaseServer();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const tenantId = claims?.tenant_id as string | undefined;
  const role = claims?.tenant_role as string | undefined;
  const userId = claims?.sub as string | undefined;

  if (!tenantId || !userId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can resolve a sync conflict.' };
  }

  const admin = createSupabaseAdmin();

  const { data: conflict } = await admin
    .from('sync_conflicts')
    .select('id, entity_type, entity_id, local_state, remote_state, applied_resolution')
    .eq('id', conflictId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{
      id: string;
      entity_type: string;
      entity_id: string | null;
      local_state: Record<string, unknown> | null;
      remote_state: Record<string, unknown> | null;
      applied_resolution: string;
    }>();

  if (!conflict) return { ok: false, error: 'That conflict no longer exists.' };
  if (conflict.applied_resolution !== 'pending') {
    return { ok: false, error: 'That conflict has already been resolved.' };
  }
  if (conflict.entity_type !== 'product' && conflict.entity_type !== 'supplier') {
    return { ok: false, error: 'This conflict type cannot be resolved here.' };
  }
  if (!conflict.entity_id) {
    return { ok: false, error: 'This conflict is missing its linked record.' };
  }

  const entityType = conflict.entity_type as ConflictEntityType;
  const table = entityType === 'product' ? 'products' : 'suppliers';

  let plan: ReturnType<typeof planConflictResolution>;
  try {
    plan = planConflictResolution({
      entityType,
      resolution,
      localState: conflict.local_state ?? {},
      remoteState: conflict.remote_state ?? {},
      mergePayload,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not resolve the conflict.',
    };
  }

  // Read the entity's current external_ids so we preserve qbo (and any other keys)
  // while stamping the adjudicated remote fingerprint.
  const { data: entityRow } = await admin
    .from(table)
    .select('external_ids')
    .eq('id', conflict.entity_id)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ external_ids: Record<string, unknown> | null }>();
  if (!entityRow) return { ok: false, error: 'The linked record no longer exists.' };

  const patch: Record<string, unknown> = {
    ...(plan.columnsToWrite ?? {}),
    external_ids: { ...(entityRow.external_ids ?? {}), qbo_fp: plan.newFp },
  };

  // CLAIM the conflict atomically (compare-and-set on still-pending) BEFORE mutating
  // the catalog. This makes the two-table resolve effectively atomic: a concurrent
  // resolve or a double-submit loses the race here and never reaches the entity write,
  // so the same conflict can't be applied twice.
  const { data: claimed, error: claimErr } = await admin
    .from('sync_conflicts')
    .update({
      applied_resolution: plan.applied,
      resolved_by_user_id: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', conflictId)
    .eq('tenant_id', tenantId)
    .eq('applied_resolution', 'pending')
    .select('id');
  if (claimErr) return { ok: false, error: 'Could not resolve the conflict. Please try again.' };
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: 'That conflict has already been resolved.' };
  }

  // `.select('id')` so we can tell a real write from a no-op: an entity deleted
  // between the external_ids read and here would make `update().eq()` match zero
  // rows and return NO error — which would otherwise mark the conflict resolved
  // without ever mutating the catalog. Treat zero rows like a failure.
  const { data: written, error: writeErr } = await admin
    .from(table)
    .update(patch)
    .eq('id', conflict.entity_id)
    .eq('tenant_id', tenantId)
    .select('id');
  if (writeErr || !written || written.length === 0) {
    // Release the claim so the conflict is never left resolved-but-unapplied and
    // the operator can retry cleanly.
    await admin
      .from('sync_conflicts')
      .update({ applied_resolution: 'pending', resolved_by_user_id: null, resolved_at: null })
      .eq('id', conflictId)
      .eq('tenant_id', tenantId);
    return {
      ok: false,
      error: 'Could not apply the resolution. The linked record may have changed.',
    };
  }

  revalidatePath('/flow/sync-conflicts');
  revalidatePath('/integrations/quickbooks');
  revalidatePath(entityType === 'product' ? '/inventory' : '/suppliers');

  return { ok: true };
}
