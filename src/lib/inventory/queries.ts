import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type InventoryListRow,
  mapProductDetail,
  mapViewRow,
  type ProductDetail,
  type RawDetailProduct,
  type RawInventoryViewRow,
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
 * The list reads the `inventory_list_v` aggregate view (security_invoker), so the
 * per-SKU on-hand sum + tenant-wide classification join run set-based in SQL and
 * scale to the 5k acceptance target (see scripts/bench-inventory.mjs). The detail
 * path still embeds per-location rows directly.
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
  /** Restrict to these product ids (used by the supplier filter). Empty → no rows. */
  productIds?: string[] | null;
}

export async function listInventory(
  supabase: SupabaseClient,
  opts: ListInventoryOptions = {},
): Promise<InventoryListRow[]> {
  if (opts.productIds && opts.productIds.length === 0) {
    return [];
  }

  // Reads the index-optimized aggregate view (security_invoker → RLS still fences
  // to the caller's tenant). Sum-by-SKU + tenant-wide classification happen in SQL.
  let query = supabase
    .from('inventory_list_v')
    .select(
      'id, sku, name, status, unit_of_measure, on_hand, allocated, in_transit, abc_class, xyz_class',
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

  if (opts.productIds) {
    query = query.in('id', opts.productIds);
  }

  const { data, error } = await query.returns<RawInventoryViewRow[]>();
  if (error) {
    throw new Error(`listInventory failed: ${error.message}`);
  }

  return (data ?? []).map(mapViewRow);
}

/** Product ids sourced by a supplier (for the supplier filter), RLS-scoped. */
export async function productIdsForSupplier(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_suppliers')
    .select('product_id')
    .eq('supplier_id', supplierId)
    .returns<{ product_id: string }[]>();
  if (error) {
    throw new Error(`productIdsForSupplier failed: ${error.message}`);
  }
  return (data ?? []).map((r) => r.product_id);
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

  // First receipt anchors the lifetime chain's STOCKED link; the latest
  // forecast lights FORECASTED (Block 8 Wave 2c). Both RLS-scoped; null keeps
  // the chain link pending.
  const [{ data: firstReceipt }, { data: latestForecast }] = await Promise.all([
    supabase
      .from('stock_movements')
      .select('occurred_at')
      .eq('product_id', productId)
      .eq('type', 'receipt')
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle<{ occurred_at: string }>(),
    supabase
      .from('forecasts')
      .select('computed_at, promoted')
      .eq('product_id', productId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ computed_at: string; promoted: boolean }>(),
  ]);

  return {
    ...mapProductDetail(data),
    firstStockedAt: firstReceipt?.occurred_at ?? null,
    latestForecast: latestForecast
      ? { computedAt: latestForecast.computed_at, promoted: latestForecast.promoted }
      : null,
  };
}
