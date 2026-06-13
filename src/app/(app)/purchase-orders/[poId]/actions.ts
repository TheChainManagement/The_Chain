'use server';

import { revalidatePath } from 'next/cache';
import { resumeHook, start } from 'workflow/api';
import {
  type ApproveResult,
  approveAndPushPurchaseOrder,
} from '@/lib/purchase-orders/approve-core';
import { poReceiptHookToken } from '@/lib/purchase-orders/lifecycle-token';
import { type ReceiveResult, receivePurchaseOrder } from '@/lib/scorecards/receive';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { purchaseOrderLifecycleWorkflow } from '@/workflows/po-lifecycle';

/**
 * Mark a purchase order received (Block 10 → Block 11b). The event that
 * produces supplier reliability AND moves stock: the receipt RPC writes the
 * supplier_performance row, the receipt stock_movement, and the on-hand /
 * in-transit move, all in one atomic txn. owner|manager|planner (the PO write
 * role set). RLS existence check first; the write core runs via the admin
 * client (supplier_performance + inventory_levels are system-write), authorized
 * here at the gate.
 *
 * After an APPLIED receipt we resume the PO's durable lifecycle run (best
 * effort): a long-running `purchaseOrderLifecycleWorkflow` is waiting on the
 * deterministic receipt hook so it can finalize once the order is fully in.
 */

const PRIVILEGED = new Set(['owner', 'manager', 'planner']);

/**
 * Approve a draft purchase order (Block 11b). Synchronous so the operator sees
 * the outcome immediately — `sent` (written back to QuickBooks) or `exported`
 * (manual send, no connection / unmapped SKU). On the FIRST approval we start
 * the durable `purchaseOrderLifecycleWorkflow`, which parks on the receipt hook
 * to own the long wait for the goods to arrive.
 */
export async function approvePurchaseOrder(input: { poId: string }): Promise<ApproveResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'You do not have permission to approve orders.' };
  }

  // RLS-scoped existence check — a caller can only approve their own PO.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id')
    .eq('id', input.poId)
    .maybeSingle<{ id: string; supplier_id: string }>();
  if (!po) return { ok: false, error: 'That purchase order was not found.' };

  // Billing gate (FEATURES.md §Trial-expiration): a tenant whose subscription
  // has lapsed cannot place NEW orders. In-flight lifecycle workflows are
  // untouched and continue to completion — this only blocks new approvals.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status')
    .maybeSingle<{ status: string }>();
  if (sub && (sub.status === 'past_due' || sub.status === 'canceled')) {
    return {
      ok: false,
      error: 'Your subscription is not current. Restore billing to approve new orders.',
    };
  }

  const result = await approveAndPushPurchaseOrder(createSupabaseAdmin(), {
    tenantId,
    poId: input.poId,
    nowMs: Date.now(),
  });

  if (result.ok && result.applied) {
    // Hand the long receipt wait to the durable runtime. Best effort: a failed
    // start must not fail an approval that already committed in the DB.
    try {
      await start(purchaseOrderLifecycleWorkflow, [{ tenantId, poId: input.poId }]);
    } catch (err) {
      console.error(`[approve] lifecycle start failed for po=${input.poId}`, err);
    }
  }

  if (result.ok) {
    revalidatePath(`/purchase-orders/${input.poId}`);
    revalidatePath('/purchase-orders');
    revalidatePath(`/suppliers/${po.supplier_id}`);
    revalidatePath('/suppliers');
  }
  return result;
}

export async function markPurchaseOrderReceived(input: {
  poId: string;
  actualDeliveryAt: string;
  lines: { lineNo: number; receivedQty: number }[];
  idempotencyKey: string;
}): Promise<ReceiveResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'You do not have permission to receive orders.' };
  }
  if (!input.actualDeliveryAt || Number.isNaN(Date.parse(input.actualDeliveryAt))) {
    return { ok: false, error: 'Enter a valid delivery date.' };
  }
  if (!input.idempotencyKey) {
    return { ok: false, error: 'Could not record the receipt. Refresh and try again.' };
  }

  // RLS-scoped existence check — a caller can only receive their own PO.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id')
    .eq('id', input.poId)
    .maybeSingle<{ id: string; supplier_id: string }>();
  if (!po) return { ok: false, error: 'That purchase order was not found.' };

  const result = await receivePurchaseOrder(createSupabaseAdmin(), {
    tenantId,
    poId: input.poId,
    actualDeliveryAt: input.actualDeliveryAt,
    lines: input.lines,
    idempotencyKey: input.idempotencyKey,
  });

  if (result.ok && !result.replayed) {
    // On a FULL receipt, wake the durable lifecycle run parked on this PO's
    // receipt hook so it finalizes. Partial receipts already wrote stock
    // synchronously and don't need to wake the run. No run waiting (an imported
    // PO, or one never approved) is fine — resume is finalization only.
    if (result.status === 'received') {
      try {
        await resumeHook(poReceiptHookToken(input.poId), {
          status: 'received',
          actualDeliveryAt: input.actualDeliveryAt,
        });
      } catch {
        // No parked run / already resumed — non-fatal.
      }
    }

    revalidatePath(`/purchase-orders/${input.poId}`);
    revalidatePath('/purchase-orders');
    revalidatePath(`/suppliers/${po.supplier_id}`);
    revalidatePath('/suppliers');
  }
  return result;
}
