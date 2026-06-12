/**
 * Inventory-policy read model (Block 9) — RLS-scoped. Shapes the SKU detail's
 * Days-of-Supply / Stockout-Risk widgets and the what-if bench.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadTimeSource } from '@/lib/policy/compute';

export interface ProductPolicy {
  locationId: string;
  locationName: string;
  serviceLevel: number;
  leadTimeDaysUsed: number;
  /** Which source the lead time came from (FEATURES: the view shows it). */
  leadTimeSource: LeadTimeSource;
  demandDuringLeadTime: number | null;
  safetyStock: number | null;
  reorderPoint: number | null;
  recommendedOrderQty: number | null;
  daysOfSupply: number | null;
  stockoutRisk: number | null;
  computedAt: string;
  /** Last forecast point date backing this policy ("Forecast holds through"). */
  holdsThrough: string | null;
}

interface RawPolicy {
  location_id: string;
  service_level: number | string;
  lead_time_days_used: number | string;
  lead_time_source: string | null;
  demand_during_lead_time: number | string | null;
  safety_stock: number | string | null;
  reorder_point: number | string | null;
  recommended_order_qty: number | string | null;
  days_of_supply: number | string | null;
  stockout_risk_score: number | string | null;
  based_on_forecast_id: string | null;
  computed_at: string;
  locations: { name: string } | null;
}

export async function loadProductPolicies(
  supabase: SupabaseClient,
  productId: string,
): Promise<ProductPolicy[]> {
  const { data: rows } = await supabase
    .from('inventory_policy')
    .select(
      `location_id, service_level, lead_time_days_used, lead_time_source,
       demand_during_lead_time, safety_stock, reorder_point, recommended_order_qty,
       days_of_supply, stockout_risk_score, based_on_forecast_id, computed_at,
       locations ( name )`,
    )
    .eq('product_id', productId)
    .returns<RawPolicy[]>();
  if (!rows || rows.length === 0) return [];

  // "Forecast holds through" = the last forecast point behind each policy.
  const forecastIds = [...new Set(rows.map((r) => r.based_on_forecast_id).filter(Boolean))];
  const holdsByForecast = new Map<string, string>();
  if (forecastIds.length > 0) {
    const { data: points } = await supabase
      .from('forecast_points')
      .select('forecast_id, period_date')
      .in('forecast_id', forecastIds as string[])
      .returns<{ forecast_id: string; period_date: string }[]>();
    for (const p of points ?? []) {
      const prev = holdsByForecast.get(p.forecast_id);
      if (!prev || p.period_date > prev) holdsByForecast.set(p.forecast_id, p.period_date);
    }
  }

  return rows.map((r) => ({
    locationId: r.location_id,
    locationName: r.locations?.name ?? '—',
    serviceLevel: Number(r.service_level),
    leadTimeDaysUsed: Number(r.lead_time_days_used),
    // Stored at derivation (never recomputed at read time — the label must not
    // drift from the number). Pre-migration rows default to 'supplier'.
    leadTimeSource: r.lead_time_source === 'scorecard' ? 'scorecard' : 'supplier',
    demandDuringLeadTime: num(r.demand_during_lead_time),
    safetyStock: num(r.safety_stock),
    reorderPoint: num(r.reorder_point),
    recommendedOrderQty: num(r.recommended_order_qty),
    daysOfSupply: num(r.days_of_supply),
    stockoutRisk: num(r.stockout_risk_score),
    computedAt: r.computed_at,
    holdsThrough: r.based_on_forecast_id
      ? (holdsByForecast.get(r.based_on_forecast_id) ?? null)
      : null,
  }));
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Semantic tone for the DOS widget: can the position outlast replenishment? */
export function dosTone(
  daysOfSupply: number | null,
  leadTimeDays: number,
): 'flow' | 'warn' | 'stop' | 'mid' {
  if (daysOfSupply == null) return 'mid';
  if (daysOfSupply >= leadTimeDays * 1.5) return 'flow';
  if (daysOfSupply >= leadTimeDays) return 'warn';
  return 'stop';
}

/** Semantic tone for the stockout-risk widget. */
export function riskTone(risk: number | null): 'flow' | 'warn' | 'stop' | 'mid' {
  if (risk == null) return 'mid';
  if (risk < 0.05) return 'flow';
  if (risk < 0.2) return 'warn';
  return 'stop';
}
