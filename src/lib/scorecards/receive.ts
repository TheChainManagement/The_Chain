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
  /**
   * Caller-stable key for THIS receipt submission. A re-click or a retried
   * request carrying the same key is a no-op (Block 11b): the receipt is not
   * naturally idempotent — it writes stock + a performance row — so the RPC
   * dedupes on `(tenant, key)` and returns `replayed: true` without re-applying.
   */
  idempotencyKey: string;
}

export type ReceiveResult =
  | { ok: true; status: 'partial_received' | 'received'; sampleSize: number; replayed: boolean }
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
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    const code = (error.message.match(/\b(po_not_found|po_terminal|nothing_received)\b/) ?? [])[1];
    const mapped = code ? RPC_ERRORS[code] : undefined;
    return { ok: false, error: mapped ?? 'Could not record the receipt.' };
  }
  const row = (
    data as {
      out_status: 'partial_received' | 'received';
      out_supplier_id: string;
      out_applied: boolean;
    }[]
  )?.[0];
  if (!row) return { ok: false, error: 'Could not record the receipt.' };

  // A replayed key changed nothing; skip the (idempotent but wasteful) rollup
  // and report the current state so the UI settles without a second write.
  if (!row.out_applied) {
    return { ok: true, status: row.out_status, sampleSize: 0, replayed: true };
  }

  const sampleSize = await rollupSupplierScorecards(admin, params.tenantId, row.out_supplier_id);
  return { ok: true, status: row.out_status, sampleSize, replayed: false };
}
