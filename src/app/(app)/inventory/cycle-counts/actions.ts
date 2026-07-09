'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ensurePrimaryLocation } from '@/lib/import/commit';
import { closeCycleCount } from '@/lib/storeroom/post';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Cycle-count actions (W2-2). Session + line writes go through the RLS client
 * (cycle_count tables are owner/manager/warehouse-writable by policy — the DB
 * is the authority). The CLOSE is the money path: it posts cycle_count
 * movements and reconciles on_hand, so it runs through the atomic RPC under
 * the service-role client with the same app-layer gate as issue/adjust.
 */

const OPERATOR_ROLES = new Set(['owner', 'manager', 'warehouse']);
const PERMISSION_MESSAGE = 'You do not have permission to run counts.';

async function resolveOperator(): Promise<{ tenantId: string; userId: string } | null> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;
  const userId = data?.claims?.sub as string | undefined;
  if (!tenantId || !userId || !role || !OPERATOR_ROLES.has(role)) return null;
  return { tenantId, userId };
}

export type StartCountState = { ok: false; error: string } | null;

export async function startCountSession(
  _prev: StartCountState,
  _formData: FormData,
): Promise<StartCountState> {
  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };

  const locationId = await ensurePrimaryLocation(createSupabaseAdmin(), operator.tenantId);

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('cycle_count_sessions')
    .insert({
      tenant_id: operator.tenantId,
      location_id: locationId,
      created_by_user_id: operator.userId,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: 'Could not start a count session. Try again.' };
  }

  revalidatePath('/inventory/cycle-counts');
  redirect(`/inventory/cycle-counts/${data.id}`);
}

export type CountLineState =
  | { ok: true; sku: string; countedQty: number }
  | { ok: false; error: string }
  | null;

export async function saveCountLine(
  _prev: CountLineState,
  formData: FormData,
): Promise<CountLineState> {
  const sessionId = String(formData.get('session_id') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const countedRaw = String(formData.get('counted_qty') ?? '').trim();
  const countedQty = Number(countedRaw);

  if (!sessionId) return { ok: false, error: 'Missing session reference.' };
  if (!sku) return { ok: false, error: 'Enter the SKU you counted.' };
  if (countedRaw === '' || !Number.isFinite(countedQty) || countedQty < 0) {
    return { ok: false, error: 'Enter the counted quantity (zero or more).' };
  }

  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };

  const supabase = await createSupabaseServer();

  const { data: session } = await supabase
    .from('cycle_count_sessions')
    .select('id, status, location_id')
    .eq('id', sessionId)
    .maybeSingle<{ id: string; status: string; location_id: string }>();
  if (!session) return { ok: false, error: 'That count session was not found.' };
  if (session.status !== 'open' && session.status !== 'in_progress') {
    return { ok: false, error: 'That count session is already closed.' };
  }

  // Case-insensitive exact SKU match (ilike with no wildcards).
  const { data: product } = await supabase
    .from('products')
    .select('id, sku')
    .ilike('sku', sku)
    .maybeSingle<{ id: string; sku: string }>();
  if (!product) return { ok: false, error: `No SKU matches "${sku}".` };

  const { data: existing } = await supabase
    .from('cycle_count_lines')
    .select('product_id')
    .eq('session_id', sessionId)
    .eq('product_id', product.id)
    .maybeSingle<{ product_id: string }>();

  if (existing) {
    // Recount: update the count, keep the original expected snapshot.
    const { error } = await supabase
      .from('cycle_count_lines')
      .update({ counted_qty: countedQty, counted_by_user_id: operator.userId })
      .eq('session_id', sessionId)
      .eq('product_id', product.id);
    if (error) return { ok: false, error: 'Could not save that count. Try again.' };
  } else {
    // Expected = system on_hand at ENTRY time (the report baseline); the close
    // RPC reconciles against on_hand at CLOSE under a row lock.
    const { data: level } = await supabase
      .from('inventory_levels')
      .select('on_hand')
      .eq('product_id', product.id)
      .eq('location_id', session.location_id)
      .maybeSingle<{ on_hand: number | string }>();

    const { error } = await supabase.from('cycle_count_lines').insert({
      tenant_id: operator.tenantId,
      session_id: sessionId,
      product_id: product.id,
      expected_qty: Number(level?.on_hand ?? 0),
      counted_qty: countedQty,
      counted_by_user_id: operator.userId,
    });
    if (error) return { ok: false, error: 'Could not save that count. Try again.' };
  }

  revalidatePath(`/inventory/cycle-counts/${sessionId}`);
  return { ok: true, sku: product.sku, countedQty };
}

export type CloseCountState =
  | { ok: true; lines: number; movements: number; absVariance: number }
  | { ok: false; error: string };

export async function closeCountSession(input: {
  sessionId: string;
  idempotencyKey: string;
}): Promise<CloseCountState> {
  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };
  if (!input.sessionId || !input.idempotencyKey) {
    return { ok: false, error: 'Could not close the session. Refresh and try again.' };
  }

  const result = await closeCycleCount(createSupabaseAdmin(), {
    tenantId: operator.tenantId,
    sessionId: input.sessionId,
    actorUserId: operator.userId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) return result;

  revalidatePath(`/inventory/cycle-counts/${input.sessionId}`);
  revalidatePath('/inventory/cycle-counts');
  revalidatePath('/inventory');
  return {
    ok: true,
    lines: result.lines,
    movements: result.movements,
    absVariance: result.absVariance,
  };
}
