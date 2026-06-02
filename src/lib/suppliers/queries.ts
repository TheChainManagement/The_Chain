import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mapSupplierDetail,
  mapSupplierListRow,
  type RawSupplierDetail,
  type RawSupplierListRow,
  RELIABILITY_TILES,
  type SupplierDetail,
  type SupplierListRow,
} from './transform';

/**
 * Supplier master-data reads (Block 4). Server-only. Tenant fencing is RLS
 * (`tenant_id = jwt_tenant_id()`); these helpers never take a tenant_id. Mapping
 * (OTIF tone inputs, the reliability ribbon) lives in transform.ts.
 *
 * OTIF + the reliability ribbon read from supplier_scorecards / supplier_performance,
 * which stay empty until the PO lifecycle + scorecard rollup (Blocks 10/11) land.
 * The shapes are wired now so those surfaces fill in place with zero refactor.
 */

export type { SupplierDetail, SupplierListRow } from './transform';

export interface SupplierOption {
  id: string;
  name: string;
}

export async function listSuppliers(
  supabase: SupabaseClient,
  opts: { includeArchived?: boolean } = {},
): Promise<SupplierListRow[]> {
  let query = supabase
    .from('suppliers')
    .select(
      `id, name, status, default_lead_time_days, min_order_value,
       product_suppliers ( count ),
       supplier_scorecards ( window_kind, otif_pct, lead_time_avg_days, sample_size )`,
    )
    .order('name', { ascending: true });

  if (!opts.includeArchived) {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query.returns<RawSupplierListRow[]>();
  if (error) {
    throw new Error(`listSuppliers failed: ${error.message}`);
  }
  return (data ?? []).map(mapSupplierListRow);
}

/** Lightweight active-supplier list for the product link picker. */
export async function listSupplierOptions(supabase: SupabaseClient): Promise<SupplierOption[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('status', 'active')
    .order('name', { ascending: true })
    .returns<SupplierOption[]>();
  if (error) {
    throw new Error(`listSupplierOptions failed: ${error.message}`);
  }
  return data ?? [];
}

export async function getSupplierDetail(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<SupplierDetail | null> {
  const { data, error } = await supabase
    .from('suppliers')
    .select(
      `id, name, status, contact, default_lead_time_days, min_order_value, qbo_vendor_id,
       created_at, updated_at,
       product_suppliers ( product_id, unit_cost, lead_time_days, moq, is_primary,
         products ( sku, name ) ),
       supplier_performance ( on_time, in_full, on_time_in_full, actual_delivery_at, recorded_at, po_id ),
       supplier_scorecards ( window_kind, otif_pct, lead_time_avg_days, sample_size )`,
    )
    .eq('id', supplierId)
    .order('recorded_at', { referencedTable: 'supplier_performance', ascending: false })
    .limit(RELIABILITY_TILES, { referencedTable: 'supplier_performance' })
    .maybeSingle<RawSupplierDetail>();

  if (error) {
    throw new Error(`getSupplierDetail failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapSupplierDetail(data);
}
