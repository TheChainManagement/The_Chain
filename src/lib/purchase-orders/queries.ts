import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mapPurchaseOrderRow,
  type PurchaseOrderListRow,
  type RawPurchaseOrderRow,
} from './transform';

/**
 * Purchase-order reads (Block 6, Wave 6.3-A). Server-only. Tenant fencing is RLS
 * (`tenant_id = jwt_tenant_id()`), so these never take a tenant_id. The embedded
 * `suppliers ( name )` rides the composite (tenant_id, supplier_id) FK; the line
 * count comes back as `purchase_order_lines ( count )`.
 */

export type { PurchaseOrderListRow } from './transform';

const SELECT = `id, external_po_id, external_reference, supplier_id, status, recommended_by,
  total, expected_delivery_at, actual_delivery_at, updated_at,
  suppliers ( name ),
  purchase_order_lines ( count )`;

export async function listPurchaseOrders(
  supabase: SupabaseClient,
): Promise<PurchaseOrderListRow[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(SELECT)
    .order('updated_at', { ascending: false })
    .returns<RawPurchaseOrderRow[]>();
  if (error) {
    throw new Error(`listPurchaseOrders failed: ${error.message}`);
  }
  return (data ?? []).map(mapPurchaseOrderRow);
}

/** A single supplier's POs, for the supplier-detail panel. */
export async function listSupplierPurchaseOrders(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<PurchaseOrderListRow[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(SELECT)
    .eq('supplier_id', supplierId)
    .order('updated_at', { ascending: false })
    .returns<RawPurchaseOrderRow[]>();
  if (error) {
    throw new Error(`listSupplierPurchaseOrders failed: ${error.message}`);
  }
  return (data ?? []).map(mapPurchaseOrderRow);
}
