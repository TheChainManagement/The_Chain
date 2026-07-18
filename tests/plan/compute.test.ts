import { describe, expect, it } from 'vitest';
import { buildPlanSnapshot, type BuildPlanSnapshotInput } from '@/lib/plan/compute';

const BASE: BuildPlanSnapshotInput = {
  capturedAt: '2026-07-18T15:00:00.000Z',
  locations: [{ id: 'north', name: 'North Warehouse', isPrimary: true }],
  products: [{ id: 'widget', sku: 'WIDGET-A', name: 'Widget A' }],
  levels: [
    {
      productId: 'widget',
      locationId: 'north',
      onHand: 80,
      onHold: 10,
      allocated: 20,
      inTransit: 40,
      avgUnitCost: 5,
    },
  ],
  forecasts: [
    {
      id: 'forecast-new',
      productId: 'widget',
      locationId: 'north',
      computedAt: '2026-07-18T14:00:00.000Z',
      points: [
        { periodDate: '2026-07-18', mean: 60 },
        { periodDate: '2026-07-25', mean: 60 },
        { periodDate: '2026-08-20', mean: 999 },
      ],
    },
  ],
  purchaseOrders: [
    {
      id: 'po-1',
      locationId: 'north',
      status: 'sent',
      expectedDeliveryAt: '2026-08-01T12:00:00.000Z',
      lines: [
        {
          productId: 'widget',
          orderedQty: 20,
          receivedQty: 5,
          unitCost: 30,
          purchaseToStockFactor: 2,
        },
      ],
    },
  ],
};

describe('30-day shared plan snapshot', () => {
  it('does not double-count in-transit and values the remaining PO commitment', () => {
    const snapshot = buildPlanSnapshot(BASE);

    // Physical ATP = 80 on hand - 10 held - 20 allocated = 50. The level's
    // in_transit 40 is removed, then the due PO remainder adds 15 × 2 = 30.
    expect(snapshot.forecastDemandUnits).toBe(120);
    expect(snapshot.coveredDemandUnits).toBe(80);
    expect(snapshot.coveragePct).toBeCloseTo(66.666, 2);
    expect(snapshot.uncoveredDemandUnits).toBe(40);
    expect(snapshot.uncoveredDemandValue).toBe(200);
    expect(snapshot.confirmedIncomingUnits).toBe(30);
    expect(snapshot.openPoCommitment).toBe(450);
    expect(snapshot.inventoryValue).toBe(400);
    expect(snapshot.topGaps[0]).toMatchObject({
      sku: 'WIDGET-A',
      locationName: 'North Warehouse',
      availableUnits: 50,
      incomingUnits: 30,
      uncoveredUnits: 40,
    });
  });

  it('uses the newest forecast and applies a tenant forecast only to the primary location', () => {
    const snapshot = buildPlanSnapshot({
      ...BASE,
      locations: [
        { id: 'north', name: 'North Warehouse', isPrimary: true },
        { id: 'south', name: 'South Yard', isPrimary: false },
      ],
      forecasts: [
        {
          id: 'old',
          productId: 'widget',
          locationId: null,
          computedAt: '2026-07-01T00:00:00.000Z',
          points: [{ periodDate: '2026-07-20', mean: 999 }],
        },
        {
          id: 'new',
          productId: 'widget',
          locationId: null,
          computedAt: '2026-07-17T00:00:00.000Z',
          points: [{ periodDate: '2026-07-20', mean: 25 }],
        },
      ],
      purchaseOrders: [],
    });

    expect(snapshot.forecastDemandUnits).toBe(25);
    expect(snapshot.dataQualityCount).toBe(1);

    const southOnly = buildPlanSnapshot({
      ...BASE,
      locations: [{ id: 'south', name: 'South Yard', isPrimary: false }],
      levels: [],
      forecasts: [
        {
          id: 'tenant',
          productId: 'widget',
          locationId: null,
          computedAt: '2026-07-17T00:00:00.000Z',
          points: [{ periodDate: '2026-07-20', mean: 25 }],
        },
      ],
      purchaseOrders: [],
    });
    expect(southOnly.forecastDemandUnits).toBe(0);
    expect(southOnly.dataQualityCount).toBe(1);
  });

  it('distinguishes a usable zero forecast from missing forecast data', () => {
    const noDemand = buildPlanSnapshot({
      ...BASE,
      forecasts: [
        {
          id: 'zero',
          productId: 'widget',
          locationId: 'north',
          computedAt: '2026-07-18T00:00:00.000Z',
          points: [{ periodDate: '2026-07-20', mean: 0 }],
        },
      ],
      purchaseOrders: [],
    });
    expect(noDemand.coveragePct).toBeNull();
    expect(noDemand.dataQualityCount).toBe(0);

    const missing = buildPlanSnapshot({ ...BASE, forecasts: [], purchaseOrders: [] });
    expect(missing.coveragePct).toBeNull();
    expect(missing.dataQualityCount).toBe(1);
  });

  it('excludes draft, terminal, and beyond-horizon orders from confirmed incoming', () => {
    const po = BASE.purchaseOrders[0]!;
    const snapshot = buildPlanSnapshot({
      ...BASE,
      purchaseOrders: [
        { ...po, id: 'draft', status: 'draft' },
        { ...po, id: 'received', status: 'received' },
        { ...po, id: 'late', expectedDeliveryAt: '2026-09-01T00:00:00.000Z' },
      ],
    });
    expect(snapshot.confirmedIncomingUnits).toBe(0);
    expect(snapshot.openPoCommitment).toBe(450);
    expect(snapshot.committedPoCount).toBe(1);
  });

  it('honors fractional purchase-to-stock conversion factors', () => {
    const po = BASE.purchaseOrders[0]!;
    const snapshot = buildPlanSnapshot({
      ...BASE,
      purchaseOrders: [
        {
          ...po,
          lines: [{ ...po.lines[0]!, purchaseToStockFactor: 0.5 }],
        },
      ],
    });
    expect(snapshot.confirmedIncomingUnits).toBe(7.5);
  });
});
