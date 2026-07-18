import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPlanSnapshot,
  type PlanForecastInput,
  type PlanPurchaseOrderInput,
  type PlanSnapshot,
} from './compute';

interface ForecastRow {
  id: string;
  product_id: string;
  location_id: string | null;
  computed_at: string;
}

interface PointRow {
  forecast_id: string;
  period_date: string;
  mean: number | string | null;
}

const POINT_BATCH_SIZE = 200;

/** Load one timestamped, RLS-scoped plan snapshot for the request. */
export async function loadPlanSnapshot(
  supabase: SupabaseClient,
  options: { capturedAt?: string; locationId?: string | null } = {},
): Promise<PlanSnapshot> {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  let locationsQuery = supabase
    .from('locations')
    .select('id, name, is_primary')
    .eq('active', true)
    .order('name');
  let levelsQuery = supabase
    .from('inventory_levels')
    .select('product_id, location_id, on_hand, on_hold, allocated, in_transit, avg_unit_cost');
  let forecastsQuery = supabase
    .from('forecasts')
    .select('id, product_id, location_id, computed_at')
    .eq('promoted', true)
    .order('computed_at', { ascending: false });
  let ordersQuery = supabase
    .from('purchase_orders')
    .select(
      `id, location_id, status, expected_delivery_at,
       purchase_order_lines ( product_id, ordered_qty, received_qty, unit_cost, purchase_to_stock_factor )`,
    )
    .in('status', ['approved', 'exported', 'sent', 'partial_received']);

  if (options.locationId) {
    locationsQuery = locationsQuery.eq('id', options.locationId);
    levelsQuery = levelsQuery.eq('location_id', options.locationId);
    forecastsQuery = forecastsQuery.or(`location_id.eq.${options.locationId},location_id.is.null`);
    ordersQuery = ordersQuery.eq('location_id', options.locationId);
  }

  const [locationsResult, productsResult, levelsResult, forecastsResult, ordersResult] =
    await Promise.all([
      locationsQuery,
      supabase.from('products').select('id, sku, name').eq('status', 'active').order('sku'),
      levelsQuery,
      forecastsQuery,
      ordersQuery,
    ]);

  for (const [label, result] of [
    ['locations', locationsResult],
    ['products', productsResult],
    ['inventory levels', levelsResult],
    ['forecasts', forecastsResult],
    ['purchase orders', ordersResult],
  ] as const) {
    if (result.error) throw new Error(`loadPlanSnapshot ${label} failed: ${result.error.message}`);
  }

  const forecastRows = (forecastsResult.data ?? []) as ForecastRow[];
  // Keep the newest promoted bundle per SKU/location before fetching its points;
  // historic promoted rows remain immutable evidence but do not drive today's plan.
  const latest = new Map<string, ForecastRow>();
  for (const row of forecastRows) {
    const pair = `${row.product_id}:${row.location_id ?? 'tenant'}`;
    if (!latest.has(pair)) latest.set(pair, row);
  }
  const latestRows = [...latest.values()];
  const points: PointRow[] = [];
  for (let index = 0; index < latestRows.length; index += POINT_BATCH_SIZE) {
    const ids = latestRows.slice(index, index + POINT_BATCH_SIZE).map((row) => row.id);
    const { data, error } = await supabase
      .from('forecast_points')
      .select('forecast_id, period_date, mean')
      .in('forecast_id', ids)
      .order('period_date');
    if (error) throw new Error(`loadPlanSnapshot forecast points failed: ${error.message}`);
    points.push(...((data ?? []) as PointRow[]));
  }
  const pointsByForecast = new Map<string, PointRow[]>();
  for (const point of points) {
    const rows = pointsByForecast.get(point.forecast_id) ?? [];
    rows.push(point);
    pointsByForecast.set(point.forecast_id, rows);
  }

  const forecasts: PlanForecastInput[] = latestRows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    computedAt: row.computed_at,
    points: (pointsByForecast.get(row.id) ?? []).map((point) => ({
      periodDate: point.period_date,
      mean: point.mean,
    })),
  }));

  const purchaseOrders: PlanPurchaseOrderInput[] = (ordersResult.data ?? []).map((row) => {
    const raw = row as {
      id: string;
      location_id: string;
      status: string;
      expected_delivery_at: string | null;
      purchase_order_lines: {
        product_id: string;
        ordered_qty: number | string;
        received_qty: number | string;
        unit_cost: number | string | null;
        purchase_to_stock_factor: number | string | null;
      }[];
    };
    return {
      id: raw.id,
      locationId: raw.location_id,
      status: raw.status,
      expectedDeliveryAt: raw.expected_delivery_at,
      lines: (raw.purchase_order_lines ?? []).map((line) => ({
        productId: line.product_id,
        orderedQty: line.ordered_qty,
        receivedQty: line.received_qty,
        unitCost: line.unit_cost,
        purchaseToStockFactor: line.purchase_to_stock_factor,
      })),
    };
  });

  return buildPlanSnapshot({
    capturedAt,
    locations: (locationsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      isPrimary: row.is_primary,
    })),
    products: (productsResult.data ?? []).map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
    })),
    levels: (levelsResult.data ?? []).map((row) => ({
      productId: row.product_id,
      locationId: row.location_id,
      onHand: row.on_hand,
      onHold: row.on_hold,
      allocated: row.allocated,
      inTransit: row.in_transit,
      avgUnitCost: row.avg_unit_cost,
    })),
    forecasts,
    purchaseOrders,
  });
}
