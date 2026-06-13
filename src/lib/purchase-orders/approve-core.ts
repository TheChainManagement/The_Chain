/**
 * PO approval write core (Block 11b) — server-only. The step that turns a draft
 * purchase order into a placed one: write it back to QuickBooks (idempotent on a
 * deterministic DocNumber) and atomically advance status + commit the ordered
 * quantity as `inventory_levels.in_transit`.
 *
 * Two outcomes by capability:
 *   * QBO-connected AND every line + the supplier carry a `qbo` external id →
 *     push to QBO, status `sent`, persist the returned entity id + DocNumber.
 *   * otherwise (no connection, or a CSV/never-synced SKU with no QBO identity)
 *     → status `exported`, no write-back. The operator sends it by hand; the
 *     CSV export route is the artifact.
 *
 * The QBO push is I/O so it runs HERE, before the SQL: `adapter.push()` is
 * idempotent (DocNumber lookup), and `apply_po_approval` is idempotent on the
 * PO's status, so a retried approval converges instead of double-committing
 * in-transit.
 *
 * Writes via the service-role admin client; authorized at the action gate.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createQboAdapterForTenant } from '@/lib/qbo/factory';
import { poDocNumber } from '@/lib/qbo/map';
import type { CanonicalPayload } from '@/lib/source-adapter';
import { CANONICAL_SCHEMA_VERSION } from '@/lib/source-adapter/canonical';

export type ApproveResult =
  | {
      ok: true;
      status: 'sent' | 'exported';
      applied: boolean;
      wroteToQbo: boolean;
      reference: string;
    }
  | { ok: false; error: string };

interface ApproveParams {
  tenantId: string;
  poId: string;
  /** Injected for deterministic token refresh in the QBO factory + tests. */
  nowMs: number;
}

interface PoRow {
  id: string;
  status: string;
  supplier_id: string;
  location_id: string;
  total: number | null;
  suppliers: { external_ids: Record<string, string> | null } | null;
}

interface LineRow {
  line_no: number;
  ordered_qty: number | string;
  unit_cost: number | string | null;
  products: { external_ids: Record<string, string> | null } | null;
}

const APPROVABLE = new Set(['draft', 'recommended']);

export async function approveAndPushPurchaseOrder(
  admin: SupabaseClient,
  params: ApproveParams,
): Promise<ApproveResult> {
  const { tenantId, poId, nowMs } = params;

  const { data: po, error: poErr } = await admin
    .from('purchase_orders')
    .select('id, status, supplier_id, location_id, total, suppliers ( external_ids )')
    .eq('tenant_id', tenantId)
    .eq('id', poId)
    .maybeSingle<PoRow>();
  if (poErr) return { ok: false, error: 'Could not load the purchase order.' };
  if (!po) return { ok: false, error: 'That purchase order was not found.' };
  if (!APPROVABLE.has(po.status)) {
    return { ok: false, error: 'This order has already been approved.' };
  }

  const { data: lines, error: lineErr } = await admin
    .from('purchase_order_lines')
    .select('line_no, ordered_qty, unit_cost, products ( external_ids )')
    .eq('tenant_id', tenantId)
    .eq('po_id', poId)
    .order('line_no')
    .returns<LineRow[]>();
  if (lineErr) return { ok: false, error: 'Could not load the order lines.' };
  if (!lines || lines.length === 0) {
    return { ok: false, error: 'This order has no lines to approve.' };
  }

  // QBO identity is required on the supplier AND every line for a clean
  // write-back. A single missing id means we cannot place the whole order in
  // QBO, so the order takes the manual (exported) path instead of a partial push.
  const supplierExternalId = po.suppliers?.external_ids?.qbo;
  const productExternalIds = lines.map((l) => l.products?.external_ids?.qbo);
  const fullyMapped = Boolean(supplierExternalId) && productExternalIds.every(Boolean);

  const reference = poDocNumber(poId);
  let wroteToQbo = false;
  let externalPoId: string | null = null;
  let externalVersion: number | null = null;

  if (fullyMapped) {
    const handle = await createQboAdapterForTenant(admin, tenantId, nowMs);
    if (handle) {
      const payload: CanonicalPayload<'purchase_order'> = {
        kind: 'purchase_order',
        externalId: poId,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        attributes: {
          supplierExternalId: supplierExternalId as string,
          reference,
          status: 'sent',
          total: po.total ?? undefined,
          lines: lines.map((l, i) => ({
            lineNo: l.line_no,
            productExternalId: productExternalIds[i] as string,
            orderedQty: Number(l.ordered_qty),
            unitCost: l.unit_cost == null ? undefined : Number(l.unit_cost),
          })),
        },
      };
      try {
        const pushed = await handle.adapter.push('purchase_order', payload, poId);
        externalPoId = pushed.externalId;
        externalVersion = pushed.externalVersion;
        wroteToQbo = true;
      } catch {
        // QBO rejected or was unreachable — fall through to the manual path so
        // approval still succeeds; the operator can export + send by hand.
        wroteToQbo = false;
      }
    }
  }

  const targetStatus: 'sent' | 'exported' = wroteToQbo ? 'sent' : 'exported';

  const { data: applied, error: rpcErr } = await admin.rpc('apply_po_approval', {
    p_tenant: tenantId,
    p_po: poId,
    p_target_status: targetStatus,
    p_external_po_id: externalPoId,
    p_external_reference: wroteToQbo ? reference : null,
    p_external_version: externalVersion,
  });
  if (rpcErr) return { ok: false, error: 'Could not advance the order. Try again.' };

  const row = (applied as { out_status: string; out_applied: boolean }[] | null)?.[0];
  const status = (row?.out_status as 'sent' | 'exported') ?? targetStatus;
  return { ok: true, status, applied: row?.out_applied ?? false, wroteToQbo, reference };
}
