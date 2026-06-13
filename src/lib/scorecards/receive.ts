/**
 * PO receipt write core (Block 10) — server-only. The event that produces
 * supplier reliability: receiving a purchase order writes its delivery facts,
 * advances the order, and rolls up the supplier's scorecard.
 *
 * The line updates + status advance + `supplier_performance` insert run
 * ATOMICALLY under a PO row lock inside the `receive_purchase_order` RPC — the
 * receipt is not idempotent and its row feeds OTIF → policy → money, so a
 * mid-sequence failure must not leave lines received without a performance row.
 * The RPC records the per-EVENT quantity (a 60/40 split → two rows of 60 and
 * 40, not a phantom 100). After the atomic write, `rollupSupplierScorecards`
 * refreshes the windows (idempotent recompute, safe outside the txn), which
 * lights the reliability ribbon and — once sample_size ≥ 5 — flips that
 * supplier's SKUs to the empirical lead time (Block 9's `chooseLeadTime`).
 *
 * Writes via the service-role admin client; authorized at the action gate.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rollupSupplierScorecards } from '@/lib/scorecards/rollup';

export interface ReceiveLineInput {
  lineNo: number;
  /** Units received in THIS receipt event (added to the line's running total). */
  receivedQty: number;
}

export interface ReceiveParams {
  tenantId: string;
  poId: string;
  /** When the goods actually arrived. */
  actualDeliveryAt: string;
  lines: ReceiveLineInput[];
}

export type ReceiveResult =
  | { ok: true; status: 'partial_received' | 'received'; sampleSize: number }
  | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  po_not_found: 'That purchase order was not found.',
  po_terminal: 'That order is already closed and cannot be received again.',
  nothing_received: 'Enter a received quantity on at least one line.',
};

export async function receivePurchaseOrder(
  admin: SupabaseClient,
  params: ReceiveParams,
): Promise<ReceiveResult> {
  // { "<lineNo>": <qty this event> } — the RPC reads current received_qty under
  // a row lock and clamps, so no read-then-write race here.
  const lineMap: Record<string, number> = {};
  for (const l of params.lines) lineMap[String(l.lineNo)] = Math.max(0, l.receivedQty);

  const { data, error } = await admin.rpc('receive_purchase_order', {
    p_tenant: params.tenantId,
    p_po: params.poId,
    p_delivered_at: params.actualDeliveryAt,
    p_lines: lineMap,
  });

  if (error) {
    const code = (error.message.match(/\b(po_not_found|po_terminal|nothing_received)\b/) ?? [])[1];
    const mapped = code ? RPC_ERRORS[code] : undefined;
    return { ok: false, error: mapped ?? 'Could not record the receipt.' };
  }
  const row = (
    data as { out_status: 'partial_received' | 'received'; out_supplier_id: string }[]
  )?.[0];
  if (!row) return { ok: false, error: 'Could not record the receipt.' };

  const sampleSize = await rollupSupplierScorecards(admin, params.tenantId, row.out_supplier_id);
  return { ok: true, status: row.out_status, sampleSize };
}
