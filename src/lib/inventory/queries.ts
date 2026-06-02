import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Inventory master-data reads (Block 3). Server-only.
 *
 * Every query runs through the request-scoped authenticated Supabase client, so
 * RLS (`tenant_id = jwt_tenant_id()`) does the tenant fencing — these helpers
 * never take a tenant_id and never widen scope. A cross-tenant productId simply
 * returns no row (→ the caller 404s).
 *
 * On-hand / allocated / in-transit are summed across the SKU's locations here in
 * TS for the list. Once `seed-5k` exists, the index-optimized aggregate moves to
 * a `security_invoker` view (the schema + indexes from Foundation already
 * support it); the read shape these helpers expose stays the same.
 */

export type ProductStatus = 'active' | 'discontinued';

export interface InventoryListRow {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  unitOfMeasure: string | null;
  onHand: number;
  allocated: number;
  inTransit: number;
  abcClass: string | null;
  xyzClass: string | null;
}

export interface ProductLocationPosition {
  locationId: string;
  locationName: string | null;
  locationType: string | null;
  onHand: number;
  allocated: number;
  inTransit: number;
  available: number;
  lastCountedAt: string | null;
}

export interface ProductSupplierLink {
  supplierId: string;
  supplierName: string | null;
  supplierSku: string | null;
  unitCost: number | null;
  leadTimeDays: number | null;
  moq: number | null;
  isPrimary: boolean;
}

export interface ProductClassification {
  abcClass: string | null;
  xyzClass: string | null;
  annualConsumptionValue: number | null;
  computedAt: string | null;
}

export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unitOfMeasure: string | null;
  status: ProductStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  totals: { onHand: number; allocated: number; inTransit: number; available: number };
  positions: ProductLocationPosition[];
  suppliers: ProductSupplierLink[];
  classification: ProductClassification | null;
  // First receipt of stock — anchors the lifetime chain's first link. null until
  // a receipt movement exists (pre-ingestion SKUs read created_at as "added").
  firstStockedAt: string | null;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

interface ListLevelRow {
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
}
interface ListClassRow {
  abc_class: string | null;
  xyz_class: string | null;
  location_id: string | null;
}
interface ListProductRow {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  unit_of_measure: string | null;
  inventory_levels: ListLevelRow[];
  product_classifications: ListClassRow[];
}

/** Tenant-wide classification (location_id null) is canonical; fall back to any. */
function pickClassification(rows: ListClassRow[]): ListClassRow | null {
  return rows.find((r) => r.location_id == null) ?? rows[0] ?? null;
}

export async function listInventory(
  supabase: SupabaseClient,
  opts: { includeDiscontinued?: boolean } = {},
): Promise<InventoryListRow[]> {
  let query = supabase
    .from('products')
    .select(
      `id, sku, name, status, unit_of_measure,
       inventory_levels ( on_hand, allocated, in_transit ),
       product_classifications ( abc_class, xyz_class, location_id )`,
    )
    .order('sku', { ascending: true });

  if (!opts.includeDiscontinued) {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query.returns<ListProductRow[]>();
  if (error) {
    throw new Error(`listInventory failed: ${error.message}`);
  }

  return (data ?? []).map((p) => {
    const cls = pickClassification(p.product_classifications ?? []);
    const levels = p.inventory_levels ?? [];
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      status: p.status,
      unitOfMeasure: p.unit_of_measure,
      onHand: levels.reduce((s, l) => s + num(l.on_hand), 0),
      allocated: levels.reduce((s, l) => s + num(l.allocated), 0),
      inTransit: levels.reduce((s, l) => s + num(l.in_transit), 0),
      abcClass: cls?.abc_class ?? null,
      xyzClass: cls?.xyz_class ?? null,
    };
  });
}

interface DetailLevelRow {
  location_id: string;
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
  last_counted_at: string | null;
  locations: { name: string | null; type: string | null } | null;
}
interface DetailSupplierRow {
  supplier_id: string;
  supplier_sku: string | null;
  unit_cost: number | string | null;
  lead_time_days: number | null;
  moq: number | null;
  is_primary: boolean;
  suppliers: { name: string | null } | null;
}
interface DetailClassRow {
  abc_class: string | null;
  xyz_class: string | null;
  annual_consumption_value: number | string | null;
  computed_at: string | null;
  location_id: string | null;
}
interface DetailProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string | null;
  status: ProductStatus;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  inventory_levels: DetailLevelRow[];
  product_suppliers: DetailSupplierRow[];
  product_classifications: DetailClassRow[];
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
    .maybeSingle<DetailProductRow>();

  if (error) {
    throw new Error(`getProductDetail failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const positions: ProductLocationPosition[] = (data.inventory_levels ?? []).map((l) => {
    const onHand = num(l.on_hand);
    const allocated = num(l.allocated);
    return {
      locationId: l.location_id,
      locationName: l.locations?.name ?? null,
      locationType: l.locations?.type ?? null,
      onHand,
      allocated,
      inTransit: num(l.in_transit),
      available: onHand - allocated,
      lastCountedAt: l.last_counted_at,
    };
  });

  const totals = positions.reduce(
    (acc, p) => ({
      onHand: acc.onHand + p.onHand,
      allocated: acc.allocated + p.allocated,
      inTransit: acc.inTransit + p.inTransit,
      available: acc.available + p.available,
    }),
    { onHand: 0, allocated: 0, inTransit: 0, available: 0 },
  );

  const suppliers: ProductSupplierLink[] = (data.product_suppliers ?? [])
    .map((s) => ({
      supplierId: s.supplier_id,
      supplierName: s.suppliers?.name ?? null,
      supplierSku: s.supplier_sku,
      unitCost: s.unit_cost == null ? null : num(s.unit_cost),
      leadTimeDays: s.lead_time_days,
      moq: s.moq,
      isPrimary: s.is_primary,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  const clsRow =
    (data.product_classifications ?? []).find((r) => r.location_id == null) ??
    (data.product_classifications ?? [])[0] ??
    null;
  const classification: ProductClassification | null = clsRow
    ? {
        abcClass: clsRow.abc_class,
        xyzClass: clsRow.xyz_class,
        annualConsumptionValue:
          clsRow.annual_consumption_value == null ? null : num(clsRow.annual_consumption_value),
        computedAt: clsRow.computed_at,
      }
    : null;

  return {
    id: data.id,
    sku: data.sku,
    name: data.name,
    description: data.description,
    unitOfMeasure: data.unit_of_measure,
    status: data.status,
    attributes: data.attributes ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    totals,
    positions,
    suppliers,
    classification,
    firstStockedAt: null,
  };
}
