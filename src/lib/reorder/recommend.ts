/**
 * Reorder recommendation math (Block 11) — pure, no I/O.
 *
 * A SKU needs reordering when its net position has fallen to or below the
 * reorder point the policy derived (Block 9). The recommended quantity is the
 * policy's recommended order qty, but never less than what it takes to clear
 * the breach back above the reorder point — so a deep hole is actually filled.
 *
 * The reason jsonb is the operator's "why": the position, the reorder point it
 * breached, the days of supply left, and the policy/forecast it came from. The
 * queue renders it so a recommendation is defensible, not a black box.
 */

export interface PolicyState {
  productId: string;
  locationId: string;
  supplierId: string | null;
  /** Net stock: on_hand − on_hold + in_transit − allocated. */
  position: number;
  reorderPoint: number;
  recommendedOrderQty: number;
  safetyStock: number;
  daysOfSupply: number | null;
  basedOnForecastId: string | null;
  basedOnPolicyComputedAt: string;
}

export interface ReorderReason {
  position: number;
  reorderPoint: number;
  safetyStock: number;
  daysOfSupply: number | null;
  /** How far below the reorder point the position sits (≥ 0). */
  shortfall: number;
  computedAt: string;
  forecastId: string | null;
}

export interface Recommendation {
  productId: string;
  locationId: string;
  supplierId: string | null;
  recommendedQty: number;
  reason: ReorderReason;
}

/** True when the position has reached or fallen below the reorder point. */
export function isBreached(p: Pick<PolicyState, 'position' | 'reorderPoint'>): boolean {
  return p.position <= p.reorderPoint;
}

/**
 * Build a recommendation for a breached SKU. Quantity = max(policy ROQ, the
 * amount needed to climb from the current position back above the reorder
 * point). Rounded up to a whole unit. Returns null when the SKU is not
 * breached (the caller filters, but this keeps the rule in one place).
 */
export function recommendFor(p: PolicyState): Recommendation | null {
  if (!isBreached(p)) return null;

  const shortfall = Math.max(0, p.reorderPoint - p.position);
  // Refill to the reorder point at minimum, but honor the policy's order qty
  // (which already carries MOQ + coverage) when it is larger.
  const qty = Math.max(0, Math.ceil(Math.max(p.recommendedOrderQty, shortfall)));

  return {
    productId: p.productId,
    locationId: p.locationId,
    supplierId: p.supplierId,
    recommendedQty: qty,
    reason: {
      position: round2(p.position),
      reorderPoint: round2(p.reorderPoint),
      safetyStock: round2(p.safetyStock),
      daysOfSupply: p.daysOfSupply == null ? null : round2(p.daysOfSupply),
      shortfall: round2(shortfall),
      computedAt: p.basedOnPolicyComputedAt,
      forecastId: p.basedOnForecastId,
    },
  };
}

/** Urgency for the queue ordering + tone: out of stock > below safety > at ROP. */
export type ReorderUrgency = 'stockout' | 'below_safety' | 'at_reorder';

export function urgency(reason: Pick<ReorderReason, 'position' | 'safetyStock'>): ReorderUrgency {
  if (reason.position <= 0) return 'stockout';
  if (reason.position < reason.safetyStock) return 'below_safety';
  return 'at_reorder';
}

const URGENCY_RANK: Record<ReorderUrgency, number> = {
  stockout: 0,
  below_safety: 1,
  at_reorder: 2,
};

/** Sort key: most urgent first, then deepest days-of-supply hole. */
export function urgencyRank(reason: ReorderReason): number {
  return URGENCY_RANK[urgency(reason)];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
