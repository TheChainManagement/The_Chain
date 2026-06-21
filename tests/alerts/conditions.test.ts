import { describe, expect, it } from 'vitest';
import { buildFireableAlerts, type ConditionInputs, dedupeKey } from '@/lib/alerts/conditions';

/**
 * Alert conditions (in-app alerts engine) — pure. Proves the fire rules,
 * severity thresholds, the one-SKU-one-alert suppression (a SKU with an open
 * recommendation fires reorder_due, not also stockout/overstock), and that each
 * alert carries an actionable operator memo + a CTA.
 */

const EMPTY: ConditionInputs = {
  policies: [],
  openRecs: [],
  latePos: [],
  syncFailures: [],
  syncConflictCount: 0,
};

describe('buildFireableAlerts', () => {
  it('fires reorder_due from an open recommendation with urgency-based severity', () => {
    const out = buildFireableAlerts({
      ...EMPTY,
      openRecs: [
        {
          productId: 'p1',
          sku: 'BLT-200',
          name: 'Bolt',
          recommendedQty: 47,
          position: -3,
          reorderPoint: 20,
          safetyStock: 10,
          daysOfSupply: 0,
        },
        {
          productId: 'p2',
          sku: 'WSH-1',
          name: 'Washer',
          recommendedQty: 10,
          position: 5,
          reorderPoint: 20,
          safetyStock: 8,
          daysOfSupply: 4,
        },
        {
          productId: 'p3',
          sku: 'NUT-9',
          name: 'Nut',
          recommendedQty: 5,
          position: 18,
          reorderPoint: 20,
          safetyStock: 8,
          daysOfSupply: 12,
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out.find((a) => a.entityId === 'p1')).toMatchObject({
      kind: 'reorder_due',
      severity: 'critical',
    }); // out of stock
    expect(out.find((a) => a.entityId === 'p2')?.severity).toBe('warn'); // below safety
    expect(out.find((a) => a.entityId === 'p3')?.severity).toBe('info'); // at ROP
    expect(out[0]?.payload.memo).toMatch(/reorder/i);
    expect(out[0]?.payload.ctaHref).toBe('/reorder');
  });

  it('a SKU with an open recommendation does NOT also fire stockout/overstock', () => {
    const out = buildFireableAlerts({
      ...EMPTY,
      openRecs: [
        {
          productId: 'p1',
          sku: 'BLT',
          name: 'Bolt',
          recommendedQty: 5,
          position: 2,
          reorderPoint: 20,
          safetyStock: 10,
          daysOfSupply: 3,
        },
      ],
      // Same SKU also looks high-risk + (absurdly) overstocked in policy — suppressed.
      policies: [
        {
          productId: 'p1',
          sku: 'BLT',
          name: 'Bolt',
          daysOfSupply: 3,
          stockoutRiskScore: 0.9,
          reorderPoint: 20,
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('reorder_due');
  });

  it('stockout_risk thresholds: <0.25 silent, then info/warn/critical', () => {
    const policy = (score: number) => ({
      productId: `p${score}`,
      sku: 'S',
      name: 'S',
      daysOfSupply: 5,
      stockoutRiskScore: score,
      reorderPoint: 10,
    });
    const out = buildFireableAlerts({
      ...EMPTY,
      policies: [policy(0.1), policy(0.3), policy(0.5), policy(0.8)],
    });
    const stockouts = out.filter((a) => a.kind === 'stockout_risk');
    expect(stockouts).toHaveLength(3); // 0.1 is below the info floor
    expect(stockouts.find((a) => a.entityId === 'p0.3')?.severity).toBe('info');
    expect(stockouts.find((a) => a.entityId === 'p0.5')?.severity).toBe('warn');
    expect(stockouts.find((a) => a.entityId === 'p0.8')?.severity).toBe('critical');
  });

  it('overstock fires only above the DOS floor and never alongside stockout risk', () => {
    const out = buildFireableAlerts({
      ...EMPTY,
      policies: [
        {
          productId: 'a',
          sku: 'A',
          name: 'A',
          daysOfSupply: 200,
          stockoutRiskScore: 0,
          reorderPoint: 10,
        }, // warn overstock
        {
          productId: 'b',
          sku: 'B',
          name: 'B',
          daysOfSupply: 100,
          stockoutRiskScore: 0,
          reorderPoint: 10,
        }, // info overstock
        {
          productId: 'c',
          sku: 'C',
          name: 'C',
          daysOfSupply: 40,
          stockoutRiskScore: 0,
          reorderPoint: 10,
        }, // nothing
      ],
    });
    const over = out.filter((a) => a.kind === 'overstock');
    expect(over).toHaveLength(2);
    expect(over.find((a) => a.entityId === 'a')?.severity).toBe('warn');
    expect(over.find((a) => a.entityId === 'b')?.severity).toBe('info');
  });

  it('po_late: warn under a week, critical at/over', () => {
    const out = buildFireableAlerts({
      ...EMPTY,
      latePos: [
        { poId: 'po1', reference: 'PO-1', supplierName: 'Acme', daysLate: 2 },
        { poId: 'po2', reference: 'PO-2', supplierName: 'Acme', daysLate: 9 },
      ],
    });
    expect(out.find((a) => a.entityId === 'po1')?.severity).toBe('warn');
    expect(out.find((a) => a.entityId === 'po2')?.severity).toBe('critical');
    expect(out.find((a) => a.entityId === 'po2')?.payload.memo).toMatch(/9 days/);
    expect(out.find((a) => a.entityId === 'po1')?.payload.ctaHref).toBe('/purchase-orders/po1');
  });

  it('sync_failure per failure; sync_conflict aggregated into one alert', () => {
    const out = buildFireableAlerts({
      ...EMPTY,
      syncFailures: [{ id: 'f1', entityType: 'Item', message: 'rate limited' }],
      syncConflictCount: 4,
    });
    const fail = out.find((a) => a.kind === 'sync_failure');
    const conflict = out.find((a) => a.kind === 'sync_conflict');
    expect(fail?.severity).toBe('warn');
    expect(fail?.payload.memo).toMatch(/rate limited/);
    expect(conflict?.payload.memo).toMatch(/4 records/);
    expect(conflict?.dedupeKey).toBe(dedupeKey('sync_conflict', null, null));
    expect(conflict?.entityId).toBeNull();
  });

  it('dedupeKey is stable and unambiguous', () => {
    expect(dedupeKey('po_late', 'purchase_order', 'po1')).toBe('po_late:purchase_order:po1');
    expect(dedupeKey('sync_conflict', null, null)).toBe('sync_conflict::');
  });
});
