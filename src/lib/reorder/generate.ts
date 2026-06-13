/**
 * Reorder recommendation generation (Block 11) — server-only.
 *
 * Reads the current policy (Block 9) + on-hand position per (product, location)
 * and writes one `reorder_recommendations` row for every breached SKU
 * (position ≤ reorder point). Runs as a step after policy derivation in the
 * forecast batch (FEATURES: "recommendation generation step post-forecast") and
 * on demand from the queue.
 *
 * Idempotent + non-duplicating: an existing OPEN recommendation for the same
 * (product, location) is UPDATED in place (qty + reason refresh, version bumps)
 * rather than stacked; a SKU that has recovered above its reorder point has its
 * open recommendation EXPIRED. Converted/dismissed rows are never touched.
 *
 * Writes via the service-role admin client (reorder_recommendations is member-
 * writable, but generation is a system action authorized at the gate/step).
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recommendFor } from '@/lib/reorder/recommend';

export interface GenerateParams {
  tenantId: string;
  /** Restrict to these products (a recompute / single-SKU); omit for all. */
  productIds?: string[];
}

export interface GenerateSummary {
  open: number;
  updated: number;
  created: number;
  expired: number;
}

interface PolicyRow {
  product_id: string;
  location_id: string;
  reorder_point: number | string | null;
  recommended_order_qty: number | string | null;
  safety_stock: number | string | null;
  days_of_supply: number | string | null;
  based_on_forecast_id: string | null;
  computed_at: string;
}
interface LevelRow {
  product_id: string;
  location_id: string;
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
}
interface ExistingRec {
  id: string;
  product_id: string;
  location_id: string;
  version: number;
  status: string;
}

export async function generateReorderRecommendations(
  admin: SupabaseClient,
  params: GenerateParams,
): Promise<GenerateSummary> {
  let policyQuery = admin
    .from('inventory_policy')
    .select(
      'product_id, location_id, reorder_point, recommended_order_qty, safety_stock, days_of_supply, based_on_forecast_id, computed_at',
    )
    .eq('tenant_id', params.tenantId);
  if (params.productIds && params.productIds.length > 0) {
    policyQuery = policyQuery.in('product_id', params.productIds);
  }
  const { data: policies, error: polErr } = await policyQuery.returns<PolicyRow[]>();
  if (polErr) throw new Error(`could not read inventory policy: ${polErr.message}`);
  if (!policies || policies.length === 0) {
    return { open: 0, updated: 0, created: 0, expired: 0 };
  }

  const productIds = [...new Set(policies.map((p) => p.product_id))];

  const [levelsRes, primaryRes, existingRes] = await Promise.all([
    admin
      .from('inventory_levels')
      .select('product_id, location_id, on_hand, allocated, in_transit')
      .eq('tenant_id', params.tenantId)
      .in('product_id', productIds)
      .returns<LevelRow[]>(),
    admin
      .from('products')
      .select('id, primary_supplier_id')
      .eq('tenant_id', params.tenantId)
      .in('id', productIds)
      .returns<{ id: string; primary_supplier_id: string | null }[]>(),
    admin
      .from('reorder_recommendations')
      .select('id, product_id, location_id, version, status')
      .eq('tenant_id', params.tenantId)
      .eq('status', 'open')
      .in('product_id', productIds)
      .returns<ExistingRec[]>(),
  ]);
  // Fail loud: a swallowed read here would breach-detect against stale/empty
  // data and silently clear or miss recommendations on the primary loop.
  const readErr = levelsRes.error ?? primaryRes.error ?? existingRes.error;
  if (readErr) throw new Error(`could not read reorder inputs: ${readErr.message}`);
  const levels = levelsRes.data;
  const primary = primaryRes.data;
  const existing = existingRes.data;

  const positionByKey = new Map<string, number>();
  for (const l of levels ?? []) {
    positionByKey.set(
      `${l.product_id}:${l.location_id}`,
      Number(l.on_hand) + Number(l.in_transit) - Number(l.allocated),
    );
  }
  const supplierByProduct = new Map((primary ?? []).map((p) => [p.id, p.primary_supplier_id]));
  const openByKey = new Map((existing ?? []).map((e) => [`${e.product_id}:${e.location_id}`, e]));

  const summary: GenerateSummary = { open: 0, updated: 0, created: 0, expired: 0 };
  const inserts: Record<string, unknown>[] = [];
  const breachedKeys = new Set<string>();
  const now = new Date().toISOString();

  for (const policy of policies) {
    const key = `${policy.product_id}:${policy.location_id}`;
    const position = positionByKey.get(key);
    // A SKU with no levels row has no known position — can't assert a breach.
    if (position == null || policy.reorder_point == null) continue;

    const rec = recommendFor({
      productId: policy.product_id,
      locationId: policy.location_id,
      supplierId: supplierByProduct.get(policy.product_id) ?? null,
      position,
      reorderPoint: Number(policy.reorder_point),
      recommendedOrderQty: Number(policy.recommended_order_qty ?? 0),
      safetyStock: Number(policy.safety_stock ?? 0),
      daysOfSupply: policy.days_of_supply == null ? null : Number(policy.days_of_supply),
      basedOnForecastId: policy.based_on_forecast_id,
      basedOnPolicyComputedAt: policy.computed_at,
    });
    if (!rec) continue;

    breachedKeys.add(key);
    summary.open++;
    const open = openByKey.get(key);

    if (open) {
      const { error: updErr } = await admin
        .from('reorder_recommendations')
        .update({
          supplier_id: rec.supplierId,
          recommended_qty: rec.recommendedQty,
          reason: rec.reason,
          based_on_forecast_id: rec.reason.forecastId,
          version: open.version + 1,
          updated_at: now,
        })
        .eq('id', open.id);
      if (updErr) throw new Error(`could not update recommendation: ${updErr.message}`);
      summary.updated++;
    } else {
      inserts.push({
        tenant_id: params.tenantId,
        product_id: rec.productId,
        location_id: rec.locationId,
        supplier_id: rec.supplierId,
        recommended_qty: rec.recommendedQty,
        reason: rec.reason,
        based_on_forecast_id: rec.reason.forecastId,
        source: 'system',
        status: 'open',
      });
      summary.created++;
    }
  }

  if (inserts.length > 0) {
    const { error } = await admin.from('reorder_recommendations').insert(inserts);
    if (error) throw new Error(`could not write reorder recommendations: ${error.message}`);
  }

  // Expire open recommendations whose SKU has recovered above the reorder point.
  const recovered = (existing ?? []).filter(
    (e) => !breachedKeys.has(`${e.product_id}:${e.location_id}`),
  );
  if (recovered.length > 0) {
    const { error: expErr } = await admin
      .from('reorder_recommendations')
      .update({ status: 'expired', updated_at: now })
      .in(
        'id',
        recovered.map((e) => e.id),
      );
    if (expErr) throw new Error(`could not expire recommendations: ${expErr.message}`);
    summary.expired = recovered.length;
  }

  return summary;
}
