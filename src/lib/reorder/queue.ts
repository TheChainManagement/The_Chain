/**
 * Reorder queue read model (Block 11) — RLS-scoped. Shapes open recommendations
 * into supplier groups (a PO has one vendor, so the queue groups by supplier),
 * each row carrying its reason + the supplier's OTIF context (the Block 10
 * scorecard embed FEATURES asks for on the reorder review).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ReorderReason,
  type ReorderUrgency,
  urgency,
  urgencyRank,
} from '@/lib/reorder/recommend';

export interface ReorderRow {
  id: string;
  productId: string;
  locationId: string;
  sku: string;
  name: string;
  recommendedQty: number;
  reason: ReorderReason;
  urgency: ReorderUrgency;
}

export interface ReorderGroup {
  /** Group identity: a PO is one supplier AND one location, so the queue groups
   * by BOTH — the convert contract rejects a mixed-location set. */
  supplierId: string | null;
  supplierName: string;
  locationId: string;
  locationName: string;
  /** Rolling-30d OTIF for the supplier, 0..1; null when no scorecard yet. */
  otifPct: number | null;
  /** Whether every row in the group can form a PO (supplier set). */
  convertible: boolean;
  rows: ReorderRow[];
}

interface RawRec {
  id: string;
  product_id: string;
  location_id: string;
  supplier_id: string | null;
  recommended_qty: number | string;
  reason: ReorderReason | null;
  products: { sku: string | null; name: string | null } | null;
  suppliers: { name: string | null } | null;
  locations: { name: string | null } | null;
}

export async function loadReorderQueue(
  supabase: SupabaseClient,
  locationId?: string | null,
): Promise<ReorderGroup[]> {
  let query = supabase
    .from('reorder_recommendations')
    .select(
      `id, product_id, location_id, supplier_id, recommended_qty, reason,
       products ( sku, name ), suppliers ( name ), locations ( name )`,
    )
    .eq('status', 'open');
  if (locationId) query = query.eq('location_id', locationId);
  const { data: recs, error } = await query.returns<RawRec[]>();
  // Fail loud: a swallowed read would render "Nothing to reorder" on the
  // product's primary action loop — a dangerous lie. Let the error boundary show.
  if (error) throw new Error(`could not load the reorder queue: ${error.message}`);
  if (!recs || recs.length === 0) return [];

  // Rolling-30d OTIF per supplier in one shot (the scorecard embed).
  const supplierIds = [...new Set(recs.map((r) => r.supplier_id).filter(Boolean))] as string[];
  const otifBySupplier = new Map<string, number | null>();
  if (supplierIds.length > 0) {
    const { data: cards, error: cardErr } = await supabase
      .from('supplier_scorecards')
      .select('supplier_id, otif_pct')
      .eq('window_kind', 'rolling_30d')
      .in('supplier_id', supplierIds)
      .returns<{ supplier_id: string; otif_pct: number | string | null }[]>();
    if (cardErr) throw new Error(`could not load supplier scorecards: ${cardErr.message}`);
    for (const c of cards ?? []) {
      otifBySupplier.set(c.supplier_id, c.otif_pct == null ? null : Number(c.otif_pct));
    }
  }

  // Group by (supplier, location) — a PO is one vendor AND one location, so a
  // set the operator can convert must share both.
  const byKey = new Map<string, ReorderGroup>();
  for (const r of recs) {
    const reason = normalizeReason(r.reason);
    const groupKey = `${r.supplier_id ?? '__none__'}:${r.location_id}`;
    let group = byKey.get(groupKey);
    if (!group) {
      group = {
        supplierId: r.supplier_id,
        supplierName: r.suppliers?.name ?? (r.supplier_id ? 'Unknown supplier' : 'No supplier set'),
        locationId: r.location_id,
        locationName: r.locations?.name ?? 'Unknown location',
        otifPct: r.supplier_id ? (otifBySupplier.get(r.supplier_id) ?? null) : null,
        convertible: Boolean(r.supplier_id),
        rows: [],
      };
      byKey.set(groupKey, group);
    }
    group.rows.push({
      id: r.id,
      productId: r.product_id,
      locationId: r.location_id,
      sku: r.products?.sku ?? '—',
      name: r.products?.name ?? '—',
      recommendedQty: Number(r.recommended_qty),
      reason,
      urgency: urgency(reason),
    });
  }

  // Rows: most urgent first within a group. Groups: a group containing the most
  // urgent row floats up; unconvertible (no-supplier) group sinks last.
  for (const g of byKey.values()) {
    g.rows.sort(
      (a, b) => urgencyRank(a.reason) - urgencyRank(b.reason) || a.sku.localeCompare(b.sku),
    );
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.convertible !== b.convertible) return a.convertible ? -1 : 1;
    const ra = Math.min(...a.rows.map((r) => urgencyRank(r.reason)));
    const rb = Math.min(...b.rows.map((r) => urgencyRank(r.reason)));
    return ra - rb || a.supplierName.localeCompare(b.supplierName);
  });
}

/** Stable composite key for a (supplier, location) group. */
export function reorderGroupKey(group: Pick<ReorderGroup, 'supplierId' | 'locationId'>): string {
  return `${group.supplierId ?? '__none__'}:${group.locationId}`;
}

/** Older rows or hand-written data may miss reason fields — fill safe defaults. */
function normalizeReason(reason: ReorderReason | null): ReorderReason {
  return {
    position: reason?.position ?? 0,
    reorderPoint: reason?.reorderPoint ?? 0,
    safetyStock: reason?.safetyStock ?? 0,
    daysOfSupply: reason?.daysOfSupply ?? null,
    shortfall: reason?.shortfall ?? 0,
    computedAt: reason?.computedAt ?? '',
    forecastId: reason?.forecastId ?? null,
  };
}
