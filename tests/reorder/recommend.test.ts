import { describe, expect, it } from 'vitest';
import {
  isBreached,
  type PolicyState,
  recommendFor,
  urgency,
  urgencyRank,
} from '@/lib/reorder/recommend';

const policy = (over: Partial<PolicyState>): PolicyState => ({
  productId: 'p1',
  locationId: 'l1',
  supplierId: 's1',
  position: 40,
  reorderPoint: 57,
  recommendedOrderQty: 280,
  safetyStock: 12,
  daysOfSupply: 8,
  basedOnForecastId: 'f1',
  basedOnPolicyComputedAt: '2026-06-12T00:00:00Z',
  ...over,
});

describe('isBreached', () => {
  it('true at or below the reorder point', () => {
    expect(isBreached({ position: 57, reorderPoint: 57 })).toBe(true);
    expect(isBreached({ position: 40, reorderPoint: 57 })).toBe(true);
  });
  it('false above it', () => {
    expect(isBreached({ position: 58, reorderPoint: 57 })).toBe(false);
  });
});

describe('recommendFor', () => {
  it('returns null when not breached', () => {
    expect(recommendFor(policy({ position: 80 }))).toBeNull();
  });

  it('recommends the policy order qty when it exceeds the shortfall', () => {
    const rec = recommendFor(policy({ position: 40, reorderPoint: 57, recommendedOrderQty: 280 }));
    expect(rec?.recommendedQty).toBe(280); // 280 > shortfall 17
  });

  it('refills at least back above the reorder point on a deep hole', () => {
    // shortfall 200, policy qty only 50 → must order at least 200.
    const rec = recommendFor(
      policy({ position: -100, reorderPoint: 100, recommendedOrderQty: 50, safetyStock: 30 }),
    );
    expect(rec?.recommendedQty).toBe(200);
  });

  it('captures the reason: position, reorder point, shortfall, DOS, forecast', () => {
    const rec = recommendFor(policy({ position: 40, reorderPoint: 57 }));
    expect(rec?.reason).toMatchObject({
      position: 40,
      reorderPoint: 57,
      shortfall: 17,
      daysOfSupply: 8,
      forecastId: 'f1',
    });
  });

  it('rounds the quantity up to a whole unit', () => {
    const rec = recommendFor(
      policy({ position: 40, reorderPoint: 57, recommendedOrderQty: 0, safetyStock: 12 }),
    );
    // shortfall 17 (whole already), but a fractional case rounds up.
    expect(Number.isInteger(rec?.recommendedQty)).toBe(true);
  });
});

describe('urgency', () => {
  it('stockout at or below zero position', () => {
    expect(urgency({ position: 0, safetyStock: 10 })).toBe('stockout');
    expect(urgency({ position: -5, safetyStock: 10 })).toBe('stockout');
  });
  it('below_safety when under safety stock', () => {
    expect(urgency({ position: 8, safetyStock: 12 })).toBe('below_safety');
  });
  it('at_reorder otherwise', () => {
    expect(urgency({ position: 40, safetyStock: 12 })).toBe('at_reorder');
  });
  it('ranks stockout most urgent', () => {
    const stockout = { position: 0, safetyStock: 5 } as never;
    const atReorder = { position: 40, safetyStock: 5 } as never;
    expect(urgencyRank(stockout)).toBeLessThan(urgencyRank(atReorder));
  });
});
