'use server';

import { revalidatePath } from 'next/cache';
import { type ReceiveResult, receivePurchaseOrder } from '@/lib/scorecards/receive';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Mark a purchase order received (Block 10) — the event that produces supplier
 * reliability. owner|manager|planner (the PO write role set). RLS existence
 * check first; the write core runs via the admin client (supplier_performance +
 * scorecards are system-write), authorized here at the gate.
 */

const PRIVILEGED = new Set(['owner', 'manager', 'planner']);

export async function markPurchaseOrderReceived(input: {
  poId: string;
  actualDeliveryAt: string;
  lines: { lineNo: number; receivedQty: number }[];
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
  });

  if (result.ok) {
    revalidatePath(`/purchase-orders/${input.poId}`);
    revalidatePath('/purchase-orders');
    revalidatePath(`/suppliers/${po.supplier_id}`);
    revalidatePath('/suppliers');
  }
  return result;
}
