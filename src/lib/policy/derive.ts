/**
 * Inventory-policy derivation (Block 9) — server-only. Runs as the policy step
 * at the end of each forecast shard (FEATURES Block 9 step 1) and after a
 * single-SKU recompute.
 *
 * For every PROMOTED forecast in the run's scope (the acceptance bar: every
 * promoted SKU has a current policy row), per (product, location):
 *
 *   demand stats   ← the forecast's own bands (compute.demandStatsFromPoints)
 *   lead time      ← supplier scorecard when sample_size ≥ 5, else the
 *                    configured product_suppliers.lead_time_days; a SKU with
 *                    NEITHER is skipped and counted — never given an invented
 *                    default
 *   service level  ← the existing policy row's saved value (the operator's
 *                    default survives recomputes), else the schema default 0.97
 *   position       ← inventory_levels (on_hand − on_hold + in_transit − allocated);
 *                    a product with no levels rows gets one policy row at the
 *                    tenant's first location with DOS/risk null (no on-hand
 *                    data is a fact, not a zero)
 *
 * Upserts `inventory_policy` on its (tenant, product, location) PK — the
 * Foundation audit triggers log every change. Writes via the service-role
 * admin client (authorized at the action/cron gate, same as the batch).
 */

import { netPosition } from '@/lib/inventory/position';
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type BandPoint,
  chooseLeadTime,
  demandStatsFromPoints,
  derivePolicy,
} from '@/lib/policy/compute';

/** One order covers the forecast horizon by default (the EOQ stand-in). */
export const COVERAGE_DAYS = 56;

export interface DerivePoliciesParams {
  tenantId: string;
  /** Forecast run whose promoted forecasts drive the policies (= sync_runs.id). */
  runId: string;
  /** Restrict to these products (a shard's slice / a single recompute). */
  productIds?: string[];
  /** Restrict a location-targeted recompute to exactly one policy row. */
  locationId?: string | null;
}

export interface DeriveSummary {
  policies: number;
  skippedNoLeadTime: number;
  skippedNoBands: number;
}

interface ForecastRow {
  id: string;
  product_id: string;
  horizon_days: number;
  location_id: string | null;
}
interface SupplierLinkRow {
  product_id: string;
  supplier_id: string;
  lead_time_days: number | string | null;
  moq: number | string | null;
  is_primary: boolean;
}
interface ScorecardRow {
  supplier_id: string;
  lead_time_avg_days: number | string | null;
  lead_time_stddev_days: number | string | null;
  sample_size: number;
}
interface LevelRow {
  product_id: string;
  location_id: string;
  on_hand: number | string;
  on_hold: number | string;
  allocated: number | string;
  in_transit: number | string;
}

export async function derivePoliciesForRun(
  admin: SupabaseClient,
  params: DerivePoliciesParams,
): Promise<DeriveSummary> {
  let forecastQuery = admin
    .from('forecasts')
    .select('id, product_id, horizon_days, location_id')
    .eq('tenant_id', params.tenantId)
    .eq('run_id', params.runId)
    .eq('promoted', true);
  if (params.productIds && params.productIds.length > 0) {
    forecastQuery = forecastQuery.in('product_id', params.productIds);
  }
  if (params.locationId) forecastQuery = forecastQuery.eq('location_id', params.locationId);
  const { data: forecasts } = await forecastQuery.returns<ForecastRow[]>();
  if (!forecasts || forecasts.length === 0) {
    return { policies: 0, skippedNoLeadTime: 0, skippedNoBands: 0 };
  }

  const productIds = forecasts.map((f) => f.product_id);
  const forecastIds = forecasts.map((f) => f.id);

  const [
    { data: points },
    { data: links },
    { data: levels },
    { data: existing },
    fallbackLocation,
  ] = await Promise.all([
    admin
      .from('forecast_points')
      .select('forecast_id, mean, lower_bound, upper_bound, lower_bound_80, upper_bound_80')
      .in('forecast_id', forecastIds)
      .order('period_date')
      .returns<
        {
          forecast_id: string;
          mean: number | string | null;
          lower_bound: number | string | null;
          upper_bound: number | string | null;
          lower_bound_80: number | string | null;
          upper_bound_80: number | string | null;
        }[]
      >(),
    admin
      .from('product_suppliers')
      .select('product_id, supplier_id, lead_time_days, moq, is_primary')
      .eq('tenant_id', params.tenantId)
      .in('product_id', productIds)
      .returns<SupplierLinkRow[]>(),
    (() => {
      let query = admin
        .from('inventory_levels')
        .select('product_id, location_id, on_hand, on_hold, allocated, in_transit')
        .eq('tenant_id', params.tenantId)
        .in('product_id', productIds);
      if (params.locationId) query = query.eq('location_id', params.locationId);
      return query.returns<LevelRow[]>();
    })(),
    admin
      .from('inventory_policy')
      .select('product_id, location_id, service_level')
      .eq('tenant_id', params.tenantId)
      .in('product_id', productIds)
      .returns<{ product_id: string; location_id: string; service_level: number | string }[]>(),
    admin
      .from('locations')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .order('created_at')
      .limit(1)
      .maybeSingle<{ id: string }>()
      .then((r) => r.data?.id ?? null),
  ]);

  // Scorecards for the primary suppliers involved (largest real sample wins).
  const primaryByProduct = new Map<string, SupplierLinkRow>();
  for (const l of links ?? []) {
    if (l.is_primary || !primaryByProduct.has(l.product_id)) {
      if (l.is_primary || primaryByProduct.get(l.product_id)?.is_primary !== true) {
        primaryByProduct.set(l.product_id, l);
      }
    }
  }
  const supplierIds = [...new Set([...primaryByProduct.values()].map((l) => l.supplier_id))];
  const { data: scorecards } = supplierIds.length
    ? await admin
        .from('supplier_scorecards')
        .select('supplier_id, lead_time_avg_days, lead_time_stddev_days, sample_size')
        .eq('tenant_id', params.tenantId)
        .in('supplier_id', supplierIds)
        .returns<ScorecardRow[]>()
    : { data: [] as ScorecardRow[] };

  const bestScorecard = new Map<string, ScorecardRow>();
  for (const s of scorecards ?? []) {
    const prev = bestScorecard.get(s.supplier_id);
    if (!prev || s.sample_size > prev.sample_size) bestScorecard.set(s.supplier_id, s);
  }

  const pointsByForecast = new Map<string, BandPoint[]>();
  for (const p of points ?? []) {
    const list = pointsByForecast.get(p.forecast_id) ?? [];
    list.push({
      mean: num(p.mean),
      lo80: num(p.lower_bound_80),
      hi80: num(p.upper_bound_80),
      lo95: num(p.lower_bound),
      hi95: num(p.upper_bound),
    });
    pointsByForecast.set(p.forecast_id, list);
  }

  const levelsByProduct = new Map<string, LevelRow[]>();
  for (const l of levels ?? []) {
    const list = levelsByProduct.get(l.product_id) ?? [];
    list.push(l);
    levelsByProduct.set(l.product_id, list);
  }

  const savedServiceLevel = new Map<string, number>();
  for (const e of existing ?? []) {
    savedServiceLevel.set(`${e.product_id}:${e.location_id}`, Number(e.service_level));
  }

  const summary: DeriveSummary = { policies: 0, skippedNoLeadTime: 0, skippedNoBands: 0 };
  const rows: Record<string, unknown>[] = [];
  const computedAt = new Date().toISOString();

  for (const f of forecasts) {
    const stats = demandStatsFromPoints(pointsByForecast.get(f.id) ?? []);
    if (!stats || stats.dailyMean <= 0) {
      summary.skippedNoBands++;
      continue;
    }

    const link = primaryByProduct.get(f.product_id) ?? null;
    const card = link ? (bestScorecard.get(link.supplier_id) ?? null) : null;
    const lead = chooseLeadTime(link ? num(link.lead_time_days) : null, {
      avgDays: card ? num(card.lead_time_avg_days) : null,
      stddevDays: card ? num(card.lead_time_stddev_days) : null,
      sampleSize: card?.sample_size ?? 0,
    });
    if (!lead) {
      summary.skippedNoLeadTime++;
      continue;
    }

    const productLevels = levelsByProduct.get(f.product_id) ?? [];
    const targets = f.location_id
      ? productLevels.length > 0
        ? productLevels
            .filter((level) => level.location_id === f.location_id)
            .map((level) => ({ locationId: level.location_id, position: netPosition(level) }))
        : [{ locationId: f.location_id, position: null }]
      : productLevels.length > 0
        ? productLevels.map((l) => ({
            locationId: l.location_id,
            position: netPosition(l),
          }))
        : fallbackLocation
          ? [{ locationId: fallbackLocation, position: null }]
          : [];

    for (const target of targets) {
      const serviceLevel = savedServiceLevel.get(`${f.product_id}:${target.locationId}`) ?? 0.97;
      const policy = derivePolicy({
        dailyMean: stats.dailyMean,
        dailySigma: stats.dailySigma,
        leadTimeDays: lead.days,
        leadSigmaDays: lead.sigmaDays,
        serviceLevel,
        moq: link ? num(link.moq) : null,
        coverageDays: COVERAGE_DAYS,
        position: target.position,
      });

      rows.push({
        tenant_id: params.tenantId,
        product_id: f.product_id,
        location_id: target.locationId,
        service_level: serviceLevel,
        lead_time_days_used: lead.days,
        lead_time_source: lead.source,
        demand_during_lead_time: round2(policy.demandDuringLeadTime),
        safety_stock: round2(policy.safetyStock),
        reorder_point: round2(policy.reorderPoint),
        recommended_order_qty: round2(policy.recommendedOrderQty),
        days_of_supply: policy.daysOfSupply == null ? null : round2(policy.daysOfSupply),
        stockout_risk_score: policy.stockoutRisk == null ? null : round4(policy.stockoutRisk),
        based_on_forecast_id: f.id,
        computed_at: computedAt,
      });
      summary.policies++;
    }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from('inventory_policy')
      .upsert(rows, { onConflict: 'tenant_id,product_id,location_id' });
    if (error) throw new Error(`could not write inventory policies: ${error.message}`);
  }

  return summary;
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
}
