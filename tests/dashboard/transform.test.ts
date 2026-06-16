import { describe, expect, it } from 'vitest';
import type { AlertView } from '@/lib/alerts/queue';
import {
  dashboardStage,
  mostUsedSupplier,
  pickMostPressingOpenPo,
  stockoutCount,
  throughputLast7Days,
  worstDaysOfSupply,
} from '@/lib/dashboard/transform';
import type { PoStatus, PurchaseOrderListRow } from '@/lib/purchase-orders/transform';
import type { ReorderGroup, ReorderRow } from '@/lib/reorder/queue';
import type { ReorderReason, ReorderUrgency } from '@/lib/reorder/recommend';

function po(
  over: Partial<PurchaseOrderListRow> & { id: string; status: PoStatus },
): PurchaseOrderListRow {
  return {
    externalPoId: null,
    reference: over.id,
    supplierId: 's1',
    supplierName: 'Acme',
    recommendedBy: 'system',
    lineCount: 1,
    total: 100,
    expectedDeliveryAt: null,
    actualDeliveryAt: null,
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

function reason(dos: number | null): ReorderReason {
  return {
    position: 5,
    reorderPoint: 10,
    safetyStock: 4,
    daysOfSupply: dos,
    shortfall: 5,
    computedAt: '2026-06-15T00:00:00.000Z',
    forecastId: null,
  };
}

function row(over: Partial<ReorderRow> & { id: string }): ReorderRow {
  return {
    productId: `p-${over.id}`,
    locationId: 'loc1',
    sku: `SKU-${over.id}`,
    name: 'Widget',
    recommendedQty: 12,
    reason: reason(20),
    urgency: 'at_reorder' as ReorderUrgency,
    ...over,
  };
}

function group(
  over: Partial<ReorderGroup> & { supplierName: string; rows: ReorderRow[] },
): ReorderGroup {
  return {
    supplierId: 's1',
    locationId: 'loc1',
    locationName: 'Primary',
    otifPct: 0.9,
    convertible: true,
    ...over,
  };
}

describe('pickMostPressingOpenPo', () => {
  it('returns null when no open POs', () => {
    expect(pickMostPressingOpenPo([po({ id: 'a', status: 'received' })])).toBeNull();
    expect(pickMostPressingOpenPo([])).toBeNull();
  });

  it('picks the soonest expected delivery among open POs', () => {
    const rows = [
      po({ id: 'late', status: 'sent', expectedDeliveryAt: '2026-06-30T00:00:00Z' }),
      po({ id: 'soon', status: 'sent', expectedDeliveryAt: '2026-06-18T00:00:00Z' }),
      po({ id: 'none', status: 'exported', expectedDeliveryAt: null }),
    ];
    expect(pickMostPressingOpenPo(rows)?.id).toBe('soon');
  });

  it('sinks null expected-delivery POs below dated ones, tie-breaks on updatedAt', () => {
    const rows = [
      po({
        id: 'old',
        status: 'sent',
        expectedDeliveryAt: null,
        updatedAt: '2026-06-01T00:00:00Z',
      }),
      po({
        id: 'new',
        status: 'sent',
        expectedDeliveryAt: null,
        updatedAt: '2026-06-09T00:00:00Z',
      }),
    ];
    expect(pickMostPressingOpenPo(rows)?.id).toBe('new');
  });
});

describe('stockoutCount + worstDaysOfSupply', () => {
  const groups = [
    group({
      supplierName: 'Acme',
      rows: [
        row({ id: '1', urgency: 'stockout', reason: reason(2) }),
        row({ id: '2', urgency: 'at_reorder', reason: reason(40) }),
      ],
    }),
    group({
      supplierName: 'Bolt',
      rows: [row({ id: '3', urgency: 'stockout', reason: reason(null) })],
    }),
  ];

  it('counts stockout-urgency rows across groups', () => {
    expect(stockoutCount(groups)).toBe(2);
  });

  it('finds the lowest non-null DOS and its SKU', () => {
    const worst = worstDaysOfSupply(groups);
    expect(worst?.dos).toBe(2);
    expect(worst?.sku).toBe('SKU-1');
  });

  it('returns null when no row has a DOS', () => {
    const g = [group({ supplierName: 'X', rows: [row({ id: 'z', reason: reason(null) })] })];
    expect(worstDaysOfSupply(g)).toBeNull();
  });
});

describe('mostUsedSupplier', () => {
  const otif = new Map<string, number | null>([
    ['s1', 0.91],
    ['s2', 0.7],
  ]);

  it('picks the supplier on the most POs and reads its OTIF from the map', () => {
    const rows = [
      po({ id: 'a', status: 'sent', supplierId: 's1', supplierName: 'Acme' }),
      po({ id: 'b', status: 'received', supplierId: 's1', supplierName: 'Acme' }),
      po({ id: 'c', status: 'sent', supplierId: 's2', supplierName: 'Bolt' }),
    ];
    const top = mostUsedSupplier(rows, otif);
    expect(top?.supplierId).toBe('s1');
    expect(top?.poCount).toBe(2);
    expect(top?.otifPct).toBe(0.91);
  });

  it('returns null otif when the supplier has no scorecard yet', () => {
    const rows = [po({ id: 'a', status: 'sent', supplierId: 's9', supplierName: 'New' })];
    expect(mostUsedSupplier(rows, otif)?.otifPct).toBeNull();
  });

  it('breaks ties by supplier name and returns null when empty', () => {
    const rows = [
      po({ id: 'a', status: 'sent', supplierId: 'z', supplierName: 'Zeta' }),
      po({ id: 'b', status: 'sent', supplierId: 'al', supplierName: 'Alpha' }),
    ];
    expect(mostUsedSupplier(rows, otif)?.supplierName).toBe('Alpha');
    expect(mostUsedSupplier([], otif)).toBeNull();
  });
});

describe('dashboardStage', () => {
  it('fresh when no catalog and nothing actionable', () => {
    expect(dashboardStage(false, [], [], [])).toBe('fresh');
  });

  it('onboarding when catalog exists but nothing actionable yet', () => {
    expect(dashboardStage(true, [], [], [])).toBe('onboarding');
  });

  it('onboarding when an alert exists but no orders or recs', () => {
    expect(dashboardStage(false, [], [], [{ id: 'a' } as AlertView])).toBe('onboarding');
  });

  it('populated when there is an order or a recommendation', () => {
    expect(dashboardStage(true, [po({ id: 'p', status: 'sent' })], [], [])).toBe('populated');
    expect(
      dashboardStage(true, [], [group({ supplierName: 'A', rows: [row({ id: '1' })] })], []),
    ).toBe('populated');
  });
});

describe('throughputLast7Days', () => {
  const now = Date.parse('2026-06-16T12:00:00Z');

  it('returns 7 buckets oldest→today with today flagged', () => {
    const buckets = throughputLast7Days([], now);
    expect(buckets).toHaveLength(7);
    expect(buckets.at(-1)?.isToday).toBe(true);
    expect(buckets.filter((b) => b.isToday)).toHaveLength(1);
  });

  it('buckets received/closed POs by actual delivery day', () => {
    const rows = [
      po({ id: 'today', status: 'received', actualDeliveryAt: '2026-06-16T08:00:00Z' }),
      po({ id: 'd2', status: 'closed', actualDeliveryAt: '2026-06-14T23:00:00Z' }),
      po({ id: 'd2b', status: 'received', actualDeliveryAt: '2026-06-14T01:00:00Z' }),
      po({ id: 'open', status: 'sent', actualDeliveryAt: null }),
      po({ id: 'stale', status: 'received', actualDeliveryAt: '2026-06-01T00:00:00Z' }),
    ];
    const buckets = throughputLast7Days(rows, now);
    expect(buckets.at(-1)?.count).toBe(1); // today (Jun 16)
    expect(buckets.at(4)?.count).toBe(2); // Jun 14
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(3); // open + stale excluded
  });
});
