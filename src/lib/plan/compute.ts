import { netPosition } from '@/lib/inventory/position';

export const PLAN_HORIZON_DAYS = 30;
export const COMMITTED_PO_STATUSES = ['approved', 'exported', 'sent', 'partial_received'] as const;

export interface PlanLocationInput {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface PlanProductInput {
  id: string;
  sku: string;
  name: string;
}

export interface PlanLevelInput {
  productId: string;
  locationId: string;
  onHand: number | string | null;
  onHold: number | string | null;
  allocated: number | string | null;
  inTransit: number | string | null;
  avgUnitCost: number | string | null;
}

export interface PlanForecastInput {
  id: string;
  productId: string;
  locationId: string | null;
  computedAt: string;
  points: { periodDate: string; mean: number | string | null }[];
}

export interface PlanPurchaseOrderInput {
  id: string;
  locationId: string;
  status: string;
  expectedDeliveryAt: string | null;
  lines: {
    productId: string;
    orderedQty: number | string;
    receivedQty: number | string;
    unitCost: number | string | null;
    purchaseToStockFactor: number | string | null;
  }[];
}

export interface CoverageGap {
  productId: string;
  locationId: string;
  sku: string;
  productName: string;
  locationName: string;
  demandUnits: number;
  availableUnits: number;
  incomingUnits: number;
  uncoveredUnits: number;
  uncoveredValue: number | null;
}

export interface PlanSnapshot {
  capturedAt: string;
  horizonEndsAt: string;
  coveragePct: number | null;
  coveredDemandUnits: number;
  forecastDemandUnits: number;
  uncoveredDemandUnits: number;
  uncoveredDemandValue: number;
  unvaluedGapUnits: number;
  inventoryValue: number;
  heldUnits: number;
  openPoCommitment: number;
  confirmedIncomingUnits: number;
  dataQualityCount: number;
  activeSkuCount: number;
  authorizedLocationCount: number;
  committedPoCount: number;
  topGaps: CoverageGap[];
}

export interface BuildPlanSnapshotInput {
  capturedAt: string;
  locations: PlanLocationInput[];
  products: PlanProductInput[];
  levels: PlanLevelInput[];
  forecasts: PlanForecastInput[];
  purchaseOrders: PlanPurchaseOrderInput[];
}

function key(productId: string, locationId: string): string {
  return `${productId}:${locationId}`;
}

function finite(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDay(value: string): string {
  return value.slice(0, 10);
}

function addUtcDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Pure 30-day shared-plan calculation. Inputs have already been fenced by RLS.
 *
 * `netPosition` includes in-transit inventory. Coverage needs physical ATP plus
 * only the committed PO remainder due in this horizon, so physical available is
 * `netPosition - in_transit`. This deliberately avoids counting the same PO in
 * both inventory_levels.in_transit and the confirmed-incoming bucket.
 */
export function buildPlanSnapshot(input: BuildPlanSnapshotInput): PlanSnapshot {
  const capturedDay = isoDay(input.capturedAt);
  const horizonEndsAt = addUtcDays(input.capturedAt, PLAN_HORIZON_DAYS);
  const primaryLocation = input.locations.find((location) => location.isPrimary);
  const locationIds = new Set(input.locations.map((location) => location.id));
  const productIds = new Set(input.products.map((product) => product.id));

  const levels = new Map(
    input.levels.map((level) => [key(level.productId, level.locationId), level]),
  );
  const latestForecasts = new Map<string, PlanForecastInput>();
  for (const forecast of input.forecasts) {
    const locationId = forecast.locationId ?? primaryLocation?.id;
    if (!locationId || !locationIds.has(locationId) || !productIds.has(forecast.productId))
      continue;
    const pairKey = key(forecast.productId, locationId);
    const current = latestForecasts.get(pairKey);
    if (!current || forecast.computedAt > current.computedAt)
      latestForecasts.set(pairKey, forecast);
  }

  const incoming = new Map<string, number>();
  let openPoCommitment = 0;
  let committedPoCount = 0;
  for (const po of input.purchaseOrders) {
    if (!locationIds.has(po.locationId) || !COMMITTED_PO_STATUSES.includes(po.status as never))
      continue;
    committedPoCount += 1;
    const dueInsideHorizon =
      po.expectedDeliveryAt !== null && isoDay(po.expectedDeliveryAt) < horizonEndsAt;
    for (const line of po.lines) {
      const remainingPurchase = Math.max(finite(line.orderedQty) - finite(line.receivedQty), 0);
      openPoCommitment += remainingPurchase * finite(line.unitCost);
      if (!dueInsideHorizon || !productIds.has(line.productId)) continue;
      const pairKey = key(line.productId, po.locationId);
      const rawFactor = finite(line.purchaseToStockFactor);
      const remainingStock = remainingPurchase * (rawFactor > 0 ? rawFactor : 1);
      incoming.set(pairKey, (incoming.get(pairKey) ?? 0) + remainingStock);
    }
  }

  let inventoryValue = 0;
  let heldUnits = 0;
  for (const level of input.levels) {
    if (!locationIds.has(level.locationId) || !productIds.has(level.productId)) continue;
    inventoryValue += Math.max(finite(level.onHand), 0) * finite(level.avgUnitCost);
    heldUnits += Math.max(finite(level.onHold), 0);
  }

  let forecastDemandUnits = 0;
  let coveredDemandUnits = 0;
  let uncoveredDemandValue = 0;
  let unvaluedGapUnits = 0;
  let dataQualityCount = 0;
  const gaps: CoverageGap[] = [];

  for (const product of input.products) {
    for (const location of input.locations) {
      const pairKey = key(product.id, location.id);
      const forecast = latestForecasts.get(pairKey);
      const horizonPoints = forecast?.points.filter(
        (point) => point.periodDate >= capturedDay && point.periodDate < horizonEndsAt,
      );
      const usable = Boolean(horizonPoints?.some((point) => point.mean !== null));
      if (!usable) {
        dataQualityCount += 1;
        continue;
      }

      const demand = (horizonPoints ?? []).reduce(
        (sum, point) => sum + Math.max(finite(point.mean), 0),
        0,
      );
      const level = levels.get(pairKey);
      const inTransit = finite(level?.inTransit);
      const available = level
        ? Math.max(
            netPosition({
              on_hand: level.onHand,
              on_hold: level.onHold,
              allocated: level.allocated,
              in_transit: level.inTransit,
            }) - inTransit,
            0,
          )
        : 0;
      const confirmedIncoming = incoming.get(pairKey) ?? 0;
      const covered = Math.min(available + confirmedIncoming, demand);
      const uncovered = Math.max(demand - covered, 0);
      const cost = level?.avgUnitCost == null ? null : finite(level.avgUnitCost);

      forecastDemandUnits += demand;
      coveredDemandUnits += covered;
      if (uncovered > 0) {
        if (cost === null) unvaluedGapUnits += uncovered;
        else uncoveredDemandValue += uncovered * cost;
        gaps.push({
          productId: product.id,
          locationId: location.id,
          sku: product.sku,
          productName: product.name,
          locationName: location.name,
          demandUnits: demand,
          availableUnits: available,
          incomingUnits: confirmedIncoming,
          uncoveredUnits: uncovered,
          uncoveredValue: cost === null ? null : uncovered * cost,
        });
      }
    }
  }

  const uncoveredDemandUnits = Math.max(forecastDemandUnits - coveredDemandUnits, 0);
  return {
    capturedAt: input.capturedAt,
    horizonEndsAt,
    coveragePct:
      forecastDemandUnits > 0
        ? Math.min((coveredDemandUnits / forecastDemandUnits) * 100, 100)
        : null,
    coveredDemandUnits,
    forecastDemandUnits,
    uncoveredDemandUnits,
    uncoveredDemandValue,
    unvaluedGapUnits,
    inventoryValue,
    heldUnits,
    openPoCommitment,
    confirmedIncomingUnits: [...incoming.values()].reduce((sum, value) => sum + value, 0),
    dataQualityCount,
    activeSkuCount: input.products.length,
    authorizedLocationCount: input.locations.length,
    committedPoCount,
    topGaps: gaps.sort((a, b) => b.uncoveredUnits - a.uncoveredUnits).slice(0, 10),
  };
}
