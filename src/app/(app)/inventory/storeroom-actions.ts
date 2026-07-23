'use server';

import { revalidatePath } from 'next/cache';
import { memberCanAccessLocation, memberCanExecute } from '@/lib/access/location-access';
import { postStockHold } from '@/lib/inventory/post-movement';
import { isActiveTenantLocation } from '@/lib/locations/validate';
import { isDemandRefType } from '@/lib/storeroom/constants';
import { postAdjustment, postIssue } from '@/lib/storeroom/post';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Storeroom operator actions (W2-2): issue material out (single or bulk = one
 * consuming object, N lines) and manual stock adjustment. Direct-callable from
 * the ledger client island (bulkArchiveProducts pattern).
 *
 * Gate: owner / manager / warehouse (MG-locked; planner plans replenishment,
 * it does not move material). The posting RPCs run under the service-role
 * client like every movement writer, so this app-layer gate is the authority —
 * same shape as the PO receive action.
 */

const PERMISSION_MESSAGE = 'You do not have permission to move stock.';

interface OperatorClaims {
  tenantId: string;
  userId: string;
}

async function resolveOperator(): Promise<OperatorClaims | null> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const userId = data?.claims?.sub as string | undefined;
  if (!tenantId || !userId) return null;
  if (!(await memberCanExecute(createSupabaseAdmin(), tenantId, userId, 'inventory.move'))) {
    return null;
  }
  return { tenantId, userId };
}

export type IssueActionState =
  | { ok: true; lines: number; totalQty: number }
  | { ok: false; error: string };

export async function issueStock(input: {
  locationId: string;
  movement: 'issue_out' | 'issue_return';
  demandRefType: string;
  demandRefId: string;
  reasonCode?: string;
  note?: string;
  lines: { productId: string; qty: number }[];
  idempotencyKey: string;
}): Promise<IssueActionState> {
  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };

  if (input.movement !== 'issue_out' && input.movement !== 'issue_return') {
    return { ok: false, error: 'That movement type is not an issue.' };
  }
  if (!isDemandRefType(input.demandRefType)) {
    return { ok: false, error: 'Pick what the material is issued to.' };
  }
  const refId = (input.demandRefId ?? '').trim();
  if (!refId) {
    return { ok: false, error: 'Enter the work order, crew, or cost center reference.' };
  }
  const lines = (input.lines ?? []).filter((l) => l.productId);
  if (lines.length === 0) {
    return { ok: false, error: 'Add at least one item to issue.' };
  }
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
    return { ok: false, error: 'Quantities must be greater than zero.' };
  }
  if (!input.idempotencyKey) {
    return { ok: false, error: 'Could not record the issue. Refresh and try again.' };
  }

  const admin = createSupabaseAdmin();
  if (
    !(await memberCanAccessLocation(admin, operator.tenantId, operator.userId, input.locationId))
  ) {
    return { ok: false, error: 'You do not have access to that location.' };
  }
  if (!(await isActiveTenantLocation(admin, operator.tenantId, input.locationId))) {
    return { ok: false, error: 'Select an active location before moving stock.' };
  }
  const result = await postIssue(admin, {
    tenantId: operator.tenantId,
    locationId: input.locationId,
    movement: input.movement,
    demandRefType: input.demandRefType,
    demandRefId: refId,
    reasonCode: input.reasonCode || null,
    note: input.note || null,
    lines,
    actorUserId: operator.userId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) return result;

  revalidatePath('/inventory');
  for (const l of lines) revalidatePath(`/inventory/${l.productId}`);
  return { ok: true, lines: result.lines, totalQty: result.totalQty };
}

export type AdjustActionState = { ok: true; onHand: number | null } | { ok: false; error: string };

export async function adjustStock(input: {
  locationId: string;
  productId: string;
  delta: number;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}): Promise<AdjustActionState> {
  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };

  if (!input.productId) return { ok: false, error: 'Missing product reference.' };
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    return { ok: false, error: 'Enter a non-zero adjustment.' };
  }
  if (!(input.reasonCode ?? '').trim()) {
    return { ok: false, error: 'Pick a reason for the adjustment.' };
  }
  if (!input.idempotencyKey) {
    return { ok: false, error: 'Could not record the adjustment. Refresh and try again.' };
  }

  const admin = createSupabaseAdmin();
  if (
    !(await memberCanAccessLocation(admin, operator.tenantId, operator.userId, input.locationId))
  ) {
    return { ok: false, error: 'You do not have access to that location.' };
  }
  if (!(await isActiveTenantLocation(admin, operator.tenantId, input.locationId))) {
    return { ok: false, error: 'Select an active location before moving stock.' };
  }
  const result = await postAdjustment(admin, {
    tenantId: operator.tenantId,
    locationId: input.locationId,
    productId: input.productId,
    delta: input.delta,
    reasonCode: input.reasonCode.trim(),
    note: input.note || null,
    actorUserId: operator.userId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) return result;

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${input.productId}`);
  return { ok: true, onHand: result.onHand };
}

export type HoldActionState =
  | { ok: true; onHand: number | null; onHold: number | null }
  | { ok: false; error: string };

export async function holdStock(input: {
  locationId: string;
  productId: string;
  movement: 'hold' | 'release';
  qty: number;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}): Promise<HoldActionState> {
  const operator = await resolveOperator();
  if (!operator) return { ok: false, error: PERMISSION_MESSAGE };

  if (!input.productId) return { ok: false, error: 'Missing product reference.' };
  if (input.movement !== 'hold' && input.movement !== 'release') {
    return { ok: false, error: 'That movement is not a hold or release.' };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: 'Enter a quantity greater than zero.' };
  }
  if (!(input.reasonCode ?? '').trim()) {
    return { ok: false, error: 'Pick a reason for the hold.' };
  }
  if (!input.idempotencyKey) {
    return { ok: false, error: 'Could not record the hold. Refresh and try again.' };
  }

  const admin = createSupabaseAdmin();
  if (
    !(await memberCanAccessLocation(admin, operator.tenantId, operator.userId, input.locationId))
  ) {
    return { ok: false, error: 'You do not have access to that location.' };
  }
  if (!(await isActiveTenantLocation(admin, operator.tenantId, input.locationId))) {
    return { ok: false, error: 'Select an active location before moving stock.' };
  }
  const result = await postStockHold(admin, {
    tenantId: operator.tenantId,
    locationId: input.locationId,
    productId: input.productId,
    movement: input.movement,
    qty: input.qty,
    reasonCode: input.reasonCode.trim(),
    note: input.note || null,
    actorUserId: operator.userId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!result.ok) return result;

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${input.productId}`);
  return { ok: true, onHand: result.onHand, onHold: result.onHold };
}
