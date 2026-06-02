import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type InventoryListRow,
  mapListRow,
  mapProductDetail,
  type ProductDetail,
  type RawDetailProduct,
  type RawListProduct,
  type StatusFilter,
  sanitizeSearch,
} from './transform';

/**
 * Inventory master-data reads (Block 3). Server-only.
 *
 * Every query runs through the request-scoped authenticated Supabase client, so
 * RLS (`tenant_id = jwt_tenant_id()`) does the tenant fencing — these helpers
 * never take a tenant_id and never widen scope. A cross-tenant productId simply
 * returns no row (→ the caller 404s). Row→model mapping lives in transform.ts
 * (pure, unit-tested).
 *
 * On-hand / allocated / in-transit are summed across locations in transform.ts
 * for the list. Once `seed-5k` exists, the index-optimized aggregate moves to a
 * `security_invoker` view (Foundation's schema + indexes already support it);
 * the read shape these helpers expose stays the same.
 */

export type {
  InventoryListRow,
  ProductClassification,
  ProductDetail,
  ProductLocationPosition,
  ProductStatus,
  ProductSupplierLink,
  StatusFilter,
} from './transform';

export interface ListInventoryOptions {
  search?: string | null;
  status?: StatusFilter;
}

export async function listInventory(
  supabase: SupabaseClient,
  opts: ListInventoryOptions = {},
): Promise<InventoryListRow[]> {
  let query = supabase
    .from('products')
    .select(
      `id, sku, name, status, unit_of_measure,
       inventory_levels ( on_hand, allocated, in_transit ),
       product_classifications ( abc_class, xyz_class, location_id )`,
    )
    .order('sku', { ascending: true });

  const status: StatusFilter = opts.status ?? 'active';
  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const term = sanitizeSearch(opts.search);
  if (term) {
    // Escaped term (transform.sanitizeSearch strips PostgREST-significant chars),
    // matched as a substring against SKU or name. `*` is PostgREST's ilike wildcard.
    query = query.or(`sku.ilike.*${term}*,name.ilike.*${term}*`);
  }

  const { data, error } = await query.returns<RawListProduct[]>();
  if (error) {
    throw new Error(`listInventory failed: ${error.message}`);
  }

  return (data ?? []).map(mapListRow);
}

export async function getProductDetail(
  supabase: SupabaseClient,
  productId: string,
): Promise<ProductDetail | null> {
  const { data, error } = await supabase
    .from('products')
    .select(
      `id, sku, name, description, unit_of_measure, status, attributes, created_at, updated_at,
       inventory_levels ( location_id, on_hand, allocated, in_transit, last_counted_at,
         locations ( name, type ) ),
       product_suppliers ( supplier_id, supplier_sku, unit_cost, lead_time_days, moq, is_primary,
         suppliers ( name ) ),
       product_classifications ( abc_class, xyz_class, annual_consumption_value, computed_at, location_id )`,
    )
    .eq('id', productId)
    .maybeSingle<RawDetailProduct>();

  if (error) {
    throw new Error(`getProductDetail failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return mapProductDetail(data);
}
