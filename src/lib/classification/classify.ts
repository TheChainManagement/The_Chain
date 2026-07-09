/**
 * Tenant ABC/XYZ classification engine (Block 7) — server-only orchestration.
 *
 * Reads a tenant's active catalog, its trailing-365d sale demand, and the primary
 * supplier unit cost per SKU; runs the pure `compute` math; and writes one
 * `product_classifications` row per SKU (tenant-wide, `location_id = null` for now —
 * the per-location dimension is wired in the schema for a later wave). A full
 * recompute is delete-then-insert: `product_classifications` has no natural unique
 * key to upsert on, and a recompute is a clean replacement of the whole snapshot.
 *
 * Writes go through the service-role admin client (the table is system-write-only,
 * RLS allows tenant SELECT but no client INSERT). Authorization happens at the
 * action gate before this runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { demandTypesForMode } from '@/lib/modes/demand';
import type { OperatingMode } from '@/lib/modes/types';
import {
  type AbcClass,
  assignAbc,
  bucketWeeklyDemand,
  computeXyz,
  DEMAND_WEEKS,
  type XyzClass,
} from './compute';

export interface ClassificationThresholds {
  id: string;
  version: number;
  abcCuts: number[];
  xyzCuts: number[];
  revenueBasis: 'cost' | 'price';
}

// Default first-run thresholds: A≤80% / B≤95% cumulative value; X≤0.5 / Y≤1.0 CV².
const DEFAULT_ABC_CUTS = [0.8, 0.95, 1.0];
const DEFAULT_XYZ_CUTS = [0.5, 1.0];

export interface ClassifySummary {
  classified: number;
  thresholdVersion: number;
}

/** Load the tenant's latest threshold version, seeding a default v1 on first run. */
export async function loadOrSeedThresholds(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ClassificationThresholds> {
  const { data: existing } = await admin
    .from('classification_thresholds')
    .select('id, version, abc_cuts, xyz_cuts, revenue_basis')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      version: number;
      abc_cuts: number[];
      xyz_cuts: number[];
      revenue_basis: 'cost' | 'price';
    }>();
  if (existing) {
    return {
      id: existing.id,
      version: existing.version,
      abcCuts: existing.abc_cuts,
      xyzCuts: existing.xyz_cuts,
      revenueBasis: existing.revenue_basis,
    };
  }

  const { data: seeded, error } = await admin
    .from('classification_thresholds')
    .insert({
      tenant_id: tenantId,
      version: 1,
      abc_cuts: DEFAULT_ABC_CUTS,
      xyz_cuts: DEFAULT_XYZ_CUTS,
      revenue_basis: 'cost',
    })
    .select('id, version')
    .single<{ id: string; version: number }>();
  if (error || !seeded)
    throw new Error(`could not seed classification thresholds: ${error?.message}`);

  return {
    id: seeded.id,
    version: seeded.version,
    abcCuts: DEFAULT_ABC_CUTS,
    xyzCuts: DEFAULT_XYZ_CUTS,
    revenueBasis: 'cost',
  };
}

interface ProductRow {
  id: string;
  primary_supplier_id: string | null;
}
interface SupplierCostRow {
  product_id: string;
  supplier_id: string;
  unit_cost: number | string | null;
  is_primary: boolean;
}
interface MovementRow {
  product_id: string;
  quantity: number | string;
  occurred_at: string;
}

/** Per-SKU primary-supplier unit cost (falls back to any supplier cost we have). */
function unitCostMap(rows: SupplierCostRow[]): Map<string, number> {
  const primary = new Map<string, number>();
  const fallback = new Map<string, number>();
  for (const r of rows) {
    const cost = r.unit_cost == null ? null : Number(r.unit_cost);
    if (cost == null || Number.isNaN(cost)) continue;
    if (r.is_primary) primary.set(r.product_id, cost);
    else if (!fallback.has(r.product_id)) fallback.set(r.product_id, cost);
  }
  const out = new Map<string, number>();
  const ids = new Set([...primary.keys(), ...fallback.keys()]);
  for (const id of ids) out.set(id, primary.get(id) ?? fallback.get(id) ?? 0);
  return out;
}

export async function classifyTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ClassifySummary> {
  const thresholds = await loadOrSeedThresholds(admin, tenantId);

  const { data: products } = await admin
    .from('products')
    .select('id, primary_supplier_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .returns<ProductRow[]>();
  if (!products || products.length === 0) {
    return { classified: 0, thresholdVersion: thresholds.version };
  }

  const { data: supplierCosts } = await admin
    .from('product_suppliers')
    .select('product_id, supplier_id, unit_cost, is_primary')
    .eq('tenant_id', tenantId)
    .returns<SupplierCostRow[]>();
  const costs = unitCostMap(supplierCosts ?? []);

  const sinceMs = Date.now() - DEMAND_WEEKS * 7 * 24 * 60 * 60 * 1000;
  // W2-2: demand is mode-routed (sales vs storeroom issues); |qty| bucketing.
  const { data: tenant } = await admin
    .from('tenants')
    .select('operating_mode')
    .eq('id', tenantId)
    .maybeSingle<{ operating_mode: OperatingMode }>();
  const demandTypes = demandTypesForMode(tenant?.operating_mode ?? null);
  const { data: movements } = await admin
    .from('stock_movements')
    .select('product_id, quantity, occurred_at')
    .eq('tenant_id', tenantId)
    .in('type', [...demandTypes])
    .gte('occurred_at', new Date(sinceMs).toISOString())
    .returns<MovementRow[]>();

  const byProduct = new Map<string, Array<{ quantity: number; occurredAt: string }>>();
  for (const m of movements ?? []) {
    const list = byProduct.get(m.product_id) ?? [];
    list.push({ quantity: Number(m.quantity), occurredAt: m.occurred_at });
    byProduct.set(m.product_id, list);
  }

  const now = Date.now();
  // Per-SKU XYZ + consumption value; collect for the cross-SKU ABC ranking.
  const perProduct = products.map((p) => {
    const moves = byProduct.get(p.id) ?? [];
    const series = bucketWeeklyDemand(moves, now);
    const xyz = computeXyz(series, thresholds.xyzCuts);
    const totalDemand = series.reduce((a, b) => a + b, 0);
    const value = totalDemand * (costs.get(p.id) ?? 0);
    return { productId: p.id, xyz, value };
  });

  const abcByProduct = new Map<string, AbcClass>();
  for (const r of assignAbc(
    perProduct.map((p) => ({ item: p.productId, value: p.value })),
    thresholds.abcCuts,
  )) {
    abcByProduct.set(r.item, r.abcClass);
  }

  const computedAt = new Date().toISOString();
  const rows = perProduct.map((p) => ({
    product_id: p.productId,
    abc_class: abcByProduct.get(p.productId) ?? null,
    xyz_class: (p.xyz.xyzClass as XyzClass | null) ?? null,
    adi: p.xyz.adi,
    cv_squared: p.xyz.cv2,
    annual_consumption_value: p.value,
    // Record the basis we ACTUALLY used. There is no price source today, so ABC is
    // always cost-based regardless of what a threshold version requests — persisting
    // the threshold's basis would be a lie. (Honored once a price field exists.)
    revenue_basis: 'cost',
    threshold_version_id: thresholds.id,
    computed_at: computedAt,
  }));

  // Atomic snapshot replace via RPC. The original insert-new-then-delete-old
  // violated `product_classifications_uniq_tenant_wide` on every recompute
  // after the first (caught live by the Block 8 batch's classify step); a
  // PostgREST upsert can't target that partial unique index, so the
  // delete+insert runs as ONE transaction in `replace_classification_snapshot`.
  const { error } = await admin.rpc('replace_classification_snapshot', {
    p_tenant: tenantId,
    p_rows: rows,
  });
  if (error) throw new Error(`could not write classifications: ${error.message}`);

  return { classified: rows.length, thresholdVersion: thresholds.version };
}
