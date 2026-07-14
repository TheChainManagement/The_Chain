import { describe, expect, it } from 'vitest';
import { buildTransferRecommendations, type TransferPosition } from '@/lib/transfers/recommend';

const position = (overrides: Partial<TransferPosition>): TransferPosition => ({
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Widget',
  locationId: 'a',
  locationName: 'A',
  onHand: 0,
  onHold: 0,
  allocated: 0,
  inTransit: 0,
  safetyStock: 0,
  reorderPoint: 0,
  ...overrides,
});

describe('transfer recommendation math', () => {
  it('caps the move by source safe surplus and destination need', () => {
    const rows = buildTransferRecommendations([
      position({
        locationId: 'source',
        locationName: 'Source',
        onHand: 100,
        onHold: 10,
        allocated: 5,
        safetyStock: 25,
      }),
      position({
        locationId: 'dest',
        locationName: 'Dest',
        onHand: 10,
        inTransit: 5,
        reorderPoint: 50,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceSurplus: 60, destinationNeed: 35, suggestedQty: 35 });
  });

  it('never recommends held, allocated, safety stock, or same-location movement', () => {
    expect(
      buildTransferRecommendations([
        position({ locationId: 'a', onHand: 20, onHold: 5, allocated: 5, safetyStock: 10 }),
        position({ locationId: 'b', reorderPoint: 50 }),
      ]),
    ).toEqual([]);
  });

  it('allocates one source surplus across needy destinations without overcommitting', () => {
    const rows = buildTransferRecommendations([
      position({ locationId: 'a', onHand: 30, safetyStock: 10 }),
      position({ locationId: 'b', reorderPoint: 15 }),
      position({ locationId: 'c', reorderPoint: 15 }),
    ]);
    expect(rows.reduce((sum, row) => sum + row.suggestedQty, 0)).toBe(20);
  });
});
