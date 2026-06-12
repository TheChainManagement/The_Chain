/**
 * What-if bench inputs (Block 9 Wave 9b) — RLS-scoped, loaded ONCE per SKU.
 *
 * The bench's sliders rerun the pure policy math client-side over this frozen
 * input set (`derivePolicy` ships to the client — it is pure), so the ripple is
 * instant and scrubbing can never touch the database. The FEATURES letter
 * suggests a Server Action per recompute; this meets its intent (250ms p95
 * ripple, zero writes until Save) at interaction speed — the save path
 * recomputes server-side as the authoritative write.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  chooseLeadTime,
  type DemandStats,
  demandStatsFromPoints,
  SCORECARD_MIN_SAMPLE,
} from '@/lib/policy/compute';

export interface WhatIfSupplierOption {
  supplierId: string;
  name: string;
  isPrimary: boolean;
  /** Lead time the policy would use for this supplier (chooseLeadTime). */
  leadTimeDays: number | null;
  leadSigmaDays: number;
  leadTimeSource: 'supplier' | 'scorecard';
  moq: number | null;
}

export interface WhatIfInputs {
  productId: string;
  sku: string;
  name: string;
  locationId: string;
  locationName: string;
  demand: DemandStats;
  /** Saved policy parameter — the sliders' starting position. */
  serviceLevel: number;
  /** Net position (on_hand + in_transit − allocated); null when unknown. */
  position: number | null;
  suppliers: WhatIfSupplierOption[];
  /** The supplier the saved policy is based on (primary). */
  primarySupplierId: string | null;
  coverageDays: number;
}

export async function loadWhatIfInputs(
  supabase: SupabaseClient,
  productId: string,
  coverageDays: number,
  locationId?: string,
): Promise<WhatIfInputs | null> {
  const { data: product } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('id', productId)
    .maybeSingle<{ id: string; sku: string; name: string }>();
  if (!product) return null;

  // Location is an explicit dimension: the bench targets the row it was aimed
  // at; without a target, the lowest location_id keeps the pick deterministic.
  let policyQuery = supabase
    .from('inventory_policy')
    .select('location_id, service_level, based_on_forecast_id, locations ( name )')
    .eq('product_id', productId);
  if (locationId) policyQuery = policyQuery.eq('location_id', locationId);
  const { data: policy } = await policyQuery.order('location_id').limit(1).maybeSingle<{
    location_id: string;
    service_level: number | string;
    based_on_forecast_id: string | null;
    locations: { name: string } | null;
  }>();
  if (!policy?.based_on_forecast_id) return null;

  const [{ data: points }, { data: links }, { data: level }] = await Promise.all([
    supabase
      .from('forecast_points')
      .select('mean, lower_bound, upper_bound, lower_bound_80, upper_bound_80')
      .eq('forecast_id', policy.based_on_forecast_id)
      .order('period_date')
      .returns<
        {
          mean: number | string | null;
          lower_bound: number | string | null;
          upper_bound: number | string | null;
          lower_bound_80: number | string | null;
          upper_bound_80: number | string | null;
        }[]
      >(),
    supabase
      .from('product_suppliers')
      .select('supplier_id, lead_time_days, moq, is_primary, suppliers ( name )')
      .eq('product_id', productId)
      .returns<
        {
          supplier_id: string;
          lead_time_days: number | string | null;
          moq: number | string | null;
          is_primary: boolean;
          suppliers: { name: string } | null;
        }[]
      >(),
    supabase
      .from('inventory_levels')
      .select('on_hand, allocated, in_transit')
      .eq('product_id', productId)
      .eq('location_id', policy.location_id)
      .maybeSingle<{
        on_hand: number | string;
        allocated: number | string;
        in_transit: number | string;
      }>(),
  ]);

  const demand = demandStatsFromPoints(
    (points ?? []).map((p) => ({
      mean: num(p.mean),
      lo80: num(p.lower_bound_80),
      hi80: num(p.upper_bound_80),
      lo95: num(p.lower_bound),
      hi95: num(p.upper_bound),
    })),
  );
  if (!demand || demand.dailyMean <= 0) return null;

  // Per-supplier lead choices (scorecards looked up in one shot).
  const supplierIds = (links ?? []).map((l) => l.supplier_id);
  const { data: cards } = supplierIds.length
    ? await supabase
        .from('supplier_scorecards')
        .select('supplier_id, lead_time_avg_days, lead_time_stddev_days, sample_size')
        .in('supplier_id', supplierIds)
        .gte('sample_size', SCORECARD_MIN_SAMPLE)
        .returns<
          {
            supplier_id: string;
            lead_time_avg_days: number | string | null;
            lead_time_stddev_days: number | string | null;
            sample_size: number;
          }[]
        >()
    : { data: [] };
  const cardBySupplier = new Map<
    string,
    { avgDays: number | null; stddevDays: number | null; sampleSize: number }
  >();
  for (const c of cards ?? []) {
    const prev = cardBySupplier.get(c.supplier_id);
    if (!prev || c.sample_size > prev.sampleSize) {
      cardBySupplier.set(c.supplier_id, {
        avgDays: num(c.lead_time_avg_days),
        stddevDays: num(c.lead_time_stddev_days),
        sampleSize: c.sample_size,
      });
    }
  }

  const suppliers: WhatIfSupplierOption[] = (links ?? []).map((l) => {
    const choice = chooseLeadTime(num(l.lead_time_days), cardBySupplier.get(l.supplier_id) ?? null);
    return {
      supplierId: l.supplier_id,
      name: l.suppliers?.name ?? '—',
      isPrimary: l.is_primary,
      leadTimeDays: choice?.days ?? null,
      leadSigmaDays: choice?.sigmaDays ?? 0,
      leadTimeSource: choice?.source ?? 'supplier',
      moq: num(l.moq),
    };
  });

  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    locationId: policy.location_id,
    locationName: policy.locations?.name ?? '—',
    demand,
    serviceLevel: Number(policy.service_level),
    position: level
      ? Number(level.on_hand) + Number(level.in_transit) - Number(level.allocated)
      : null,
    suppliers,
    primarySupplierId: suppliers.find((s) => s.isPrimary)?.supplierId ?? null,
    coverageDays,
  };
}

export interface PolicyLedgerRow {
  productId: string;
  locationId: string;
  locationName: string;
  sku: string;
  name: string;
  daysOfSupply: number | null;
  stockoutRisk: number | null;
  reorderPoint: number | null;
  leadTimeDaysUsed: number;
}

export async function listPolicies(supabase: SupabaseClient): Promise<PolicyLedgerRow[]> {
  const { data } = await supabase
    .from('inventory_policy')
    .select(
      'product_id, location_id, days_of_supply, stockout_risk_score, reorder_point, lead_time_days_used, products ( sku, name ), locations ( name )',
    )
    .returns<
      {
        product_id: string;
        location_id: string;
        days_of_supply: number | string | null;
        stockout_risk_score: number | string | null;
        reorder_point: number | string | null;
        lead_time_days_used: number | string;
        products: { sku: string; name: string } | null;
        locations: { name: string } | null;
      }[]
    >();

  return (data ?? [])
    .map((r) => ({
      productId: r.product_id,
      locationId: r.location_id,
      locationName: r.locations?.name ?? '—',
      sku: r.products?.sku ?? '—',
      name: r.products?.name ?? '—',
      daysOfSupply: num(r.days_of_supply),
      stockoutRisk: num(r.stockout_risk_score),
      reorderPoint: num(r.reorder_point),
      leadTimeDaysUsed: Number(r.lead_time_days_used),
    }))
    .sort((a, b) => (a.daysOfSupply ?? Infinity) - (b.daysOfSupply ?? Infinity));
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
