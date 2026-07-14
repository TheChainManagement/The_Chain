import type { SupabaseClient } from '@supabase/supabase-js';

export interface TransferPosition {
  productId: string;
  sku: string;
  name: string;
  locationId: string;
  locationName: string;
  onHand: number;
  onHold: number;
  allocated: number;
  inTransit: number;
  safetyStock: number;
  reorderPoint: number;
}

export interface TransferRecommendation {
  productId: string;
  sku: string;
  name: string;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  sourceSurplus: number;
  destinationNeed: number;
  suggestedQty: number;
}

export function buildTransferRecommendations(
  positions: TransferPosition[],
): TransferRecommendation[] {
  const byProduct = new Map<string, TransferPosition[]>();
  for (const position of positions) {
    const list = byProduct.get(position.productId) ?? [];
    list.push(position);
    byProduct.set(position.productId, list);
  }

  const recommendations: TransferRecommendation[] = [];
  for (const productPositions of byProduct.values()) {
    const sources = productPositions
      .map((position) => ({
        position,
        surplus: Math.max(
          0,
          position.onHand - position.onHold - position.allocated - position.safetyStock,
        ),
      }))
      .filter((source) => source.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus);
    const destinations = productPositions
      .map((position) => ({
        position,
        need: Math.max(
          0,
          position.reorderPoint -
            (position.onHand - position.onHold + position.inTransit - position.allocated),
        ),
      }))
      .filter((destination) => destination.need > 0)
      .sort((a, b) => b.need - a.need);

    for (const destination of destinations) {
      const source = sources.find(
        (candidate) =>
          candidate.position.locationId !== destination.position.locationId &&
          candidate.surplus > 0,
      );
      if (!source) continue;
      const suggestedQty = Math.min(source.surplus, destination.need);
      if (suggestedQty <= 0) continue;
      recommendations.push({
        productId: destination.position.productId,
        sku: destination.position.sku,
        name: destination.position.name,
        sourceLocationId: source.position.locationId,
        sourceLocationName: source.position.locationName,
        destinationLocationId: destination.position.locationId,
        destinationLocationName: destination.position.locationName,
        sourceSurplus: source.surplus,
        destinationNeed: destination.need,
        suggestedQty,
      });
      source.surplus -= suggestedQty;
      destination.need -= suggestedQty;
    }
  }
  return recommendations.sort(
    (a, b) => b.destinationNeed - a.destinationNeed || a.sku.localeCompare(b.sku),
  );
}

interface RawPosition {
  product_id: string;
  location_id: string;
  on_hand: number | string;
  on_hold: number | string;
  allocated: number | string;
  in_transit: number | string;
  products: { sku: string; name: string } | null;
  locations: { name: string } | null;
}

export async function loadTransferRecommendations(
  supabase: SupabaseClient,
): Promise<TransferRecommendation[]> {
  const [{ data, error }, { data: policies, error: policyError }] = await Promise.all([
    supabase
      .from('inventory_levels')
      .select(
        `product_id, location_id, on_hand, on_hold, allocated, in_transit,
         products ( sku, name ), locations ( name )`,
      )
      .returns<RawPosition[]>(),
    supabase
      .from('inventory_policy')
      .select('product_id, location_id, safety_stock, reorder_point')
      .returns<
        {
          product_id: string;
          location_id: string;
          safety_stock: number | string | null;
          reorder_point: number | string | null;
        }[]
      >(),
  ]);
  if (error) throw new Error(`loadTransferRecommendations failed: ${error.message}`);
  if (policyError) throw new Error(`loadTransferRecommendations failed: ${policyError.message}`);
  const policyByKey = new Map(
    (policies ?? []).map((policy) => [`${policy.product_id}:${policy.location_id}`, policy]),
  );
  return buildTransferRecommendations(
    (data ?? []).map((row) => ({
      productId: row.product_id,
      sku: row.products?.sku ?? '—',
      name: row.products?.name ?? '—',
      locationId: row.location_id,
      locationName: row.locations?.name ?? '—',
      onHand: Number(row.on_hand),
      onHold: Number(row.on_hold),
      allocated: Number(row.allocated),
      inTransit: Number(row.in_transit),
      safetyStock: Number(
        policyByKey.get(`${row.product_id}:${row.location_id}`)?.safety_stock ?? 0,
      ),
      reorderPoint: Number(
        policyByKey.get(`${row.product_id}:${row.location_id}`)?.reorder_point ?? 0,
      ),
    })),
  );
}
