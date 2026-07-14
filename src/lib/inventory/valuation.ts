/**
 * Inventory valuation reads (W2-2.5, kickoff Item 2b) — the "what is my
 * inventory worth" answer, priced at the moving-average cost the posting
 * kernel maintains.
 *
 * Sources: `inventory_valuation_v` (per SKU per location) and
 * `inventory_valuation_totals_v` (one set-based row per tenant). Both are
 * security_invoker views — caller RLS fences every row.
 *
 * total value INCLUDES held stock (MG 2026-07-09: you still own it); held
 * value is broken out beside it. A SKU with stock but no cost reports null
 * value — unknown, not zero — and is counted in `uncostedSkus` so the gap is
 * visible instead of silently deflating the total.
 *
 * Deferred by decision (kickoff Item 2b, not lost): FIFO cost layers, landed
 * cost, GL integration, three-way match.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ValuationRow {
  productId: string;
  sku: string;
  name: string;
  unitOfMeasure: string | null;
  locationName: string;
  onHand: number;
  onHold: number;
  avgUnitCost: number | null;
  costProvenance: 'seeded' | 'posted' | null;
  totalValue: number | null;
  heldValue: number | null;
}

interface RawValuationRow {
  product_id: string;
  sku: string;
  name: string;
  unit_of_measure: string | null;
  location_name: string;
  on_hand: number | string;
  on_hold: number | string;
  avg_unit_cost: number | string | null;
  avg_cost_provenance: 'seeded' | 'posted' | null;
  total_value: number | string | null;
  held_value: number | string | null;
}

export async function listValuation(supabase: SupabaseClient): Promise<ValuationRow[]> {
  const { data, error } = await supabase
    .from('inventory_valuation_v')
    .select(
      'product_id, sku, name, unit_of_measure, location_name, on_hand, on_hold, avg_unit_cost, avg_cost_provenance, total_value, held_value',
    )
    .order('total_value', { ascending: false, nullsFirst: false })
    .returns<RawValuationRow[]>();
  if (error) {
    throw new Error(`listValuation failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    name: r.name,
    unitOfMeasure: r.unit_of_measure,
    locationName: r.location_name,
    onHand: Number(r.on_hand),
    onHold: Number(r.on_hold),
    avgUnitCost: r.avg_unit_cost == null ? null : Number(r.avg_unit_cost),
    costProvenance: r.avg_cost_provenance,
    totalValue: r.total_value == null ? null : Number(r.total_value),
    heldValue: r.held_value == null ? null : Number(r.held_value),
  }));
}

export interface ValuationSummary {
  totalValue: number | null;
  heldValue: number | null;
  uncostedSkus: number;
}

export async function getValuationSummary(
  supabase: SupabaseClient,
  locationId?: string | null,
): Promise<ValuationSummary | null> {
  if (locationId) {
    const { data, error } = await supabase
      .from('inventory_valuation_v')
      .select('product_id, on_hand, avg_unit_cost, total_value, held_value')
      .eq('location_id', locationId)
      .returns<
        {
          product_id: string;
          on_hand: number | string;
          avg_unit_cost: number | string | null;
          total_value: number | string | null;
          held_value: number | string | null;
        }[]
      >();
    if (error) throw new Error(`getValuationSummary failed: ${error.message}`);
    const rows = data ?? [];
    const valued = rows.filter((row) => row.total_value != null);
    return {
      totalValue: valued.length
        ? valued.reduce((sum, row) => sum + Number(row.total_value), 0)
        : null,
      heldValue: valued.length
        ? valued.reduce((sum, row) => sum + Number(row.held_value ?? 0), 0)
        : null,
      uncostedSkus: new Set(
        rows
          .filter((row) => row.avg_unit_cost == null && Number(row.on_hand) !== 0)
          .map((row) => row.product_id),
      ).size,
    };
  }
  const { data, error } = await supabase
    .from('inventory_valuation_totals_v')
    .select('total_value, held_value, uncosted_skus')
    .maybeSingle<{
      total_value: number | string | null;
      held_value: number | string | null;
      uncosted_skus: number | string | null;
    }>();
  if (error) {
    throw new Error(`getValuationSummary failed: ${error.message}`);
  }
  if (!data) return null;
  return {
    totalValue: data.total_value == null ? null : Number(data.total_value),
    heldValue: data.held_value == null ? null : Number(data.held_value),
    uncostedSkus: Number(data.uncosted_skus ?? 0),
  };
}

/** Pure CSV formatter (same shape discipline as purchaseOrderToCsv). */
export function valuationToCsv(rows: ValuationRow[]): string {
  const header = [
    'sku',
    'name',
    'location',
    'stock_uom',
    'on_hand',
    'on_hold',
    'avg_unit_cost',
    'cost_provenance',
    'total_value',
    'held_value',
  ];
  const lines = rows.map((r) =>
    [
      csvField(r.sku),
      csvField(r.name),
      csvField(r.locationName),
      csvField(r.unitOfMeasure ?? ''),
      String(r.onHand),
      String(r.onHold),
      r.avgUnitCost == null ? '' : r.avgUnitCost.toFixed(4),
      csvField(r.costProvenance ?? ''),
      r.totalValue == null ? '' : r.totalValue.toFixed(2),
      r.heldValue == null ? '' : r.heldValue.toFixed(2),
    ].join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
