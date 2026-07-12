import { describe, expect, it } from 'vitest';
import { purchaseOrderToCsv } from '@/lib/purchase-orders/csv';
import type { PurchaseOrderDetail } from '@/lib/purchase-orders/transform';

/**
 * PO → CSV (Block 11b export). Pure. Proves the header, one row per line, the
 * RFC-4180 quoting of awkward names, and the unit/line totals.
 */

function detail(overrides: Partial<PurchaseOrderDetail> = {}): PurchaseOrderDetail {
  return {
    id: 'po-uuid',
    externalPoId: null,
    reference: 'TC-ABC123',
    supplierId: 'sup-1',
    supplierName: 'Atchafalaya, Inc.',
    status: 'exported',
    recommendedBy: 'system',
    lineCount: 2,
    total: 130,
    expectedDeliveryAt: '2026-07-01T00:00:00.000Z',
    actualDeliveryAt: null,
    updatedAt: '2026-06-13T00:00:00.000Z',
    createdAt: '2026-06-13T00:00:00.000Z',
    lines: [
      {
        lineNo: 1,
        productId: 'p1',
        sku: 'SKU-1',
        name: 'Widget',
        orderedQty: 10,
        receivedQty: 0,
        unitCost: 5,
        stockUom: 'ea',
        purchaseUom: null,
        purchaseToStockFactor: null,
      },
      {
        lineNo: 2,
        productId: 'p2',
        sku: 'SKU-2',
        name: 'Gadget, deluxe',
        orderedQty: 4,
        receivedQty: 2,
        unitCost: 20,
        stockUom: 'ea',
        purchaseUom: null,
        purchaseToStockFactor: null,
      },
    ],
    ...overrides,
  };
}

describe('purchaseOrderToCsv', () => {
  it('emits a header and one row per line', () => {
    const rows = purchaseOrderToCsv(detail()).trim().split('\r\n');
    expect(rows[0]).toBe(
      'po_reference,supplier,status,expected_delivery,line_no,sku,product,ordered_qty,received_qty,unit_cost,line_total',
    );
    expect(rows).toHaveLength(3); // header + 2 lines
  });

  it('quotes a value containing a comma and computes the line total', () => {
    const rows = purchaseOrderToCsv(detail()).trim().split('\r\n');
    // Supplier carries a comma → whole cell is quoted on every line.
    expect(rows[1]).toContain('"Atchafalaya, Inc."');
    // line 2: qty 4 × $20 = 80.00, product name quoted for its comma.
    expect(rows[2]).toContain('"Gadget, deluxe"');
    expect(rows[2]!.endsWith(',80.00')).toBe(true);
    expect(rows[1]!.endsWith(',50.00')).toBe(true); // 10 × 5
  });

  it('leaves cost + total blank when unit cost is unknown', () => {
    const csv = purchaseOrderToCsv(
      detail({
        lines: [
          {
            lineNo: 1,
            productId: 'p1',
            sku: 'SKU-1',
            name: 'Widget',
            orderedQty: 10,
            receivedQty: 0,
            unitCost: null,
            stockUom: 'ea',
            purchaseUom: null,
            purchaseToStockFactor: null,
          },
        ],
      }),
    );
    const row = csv.trim().split('\r\n')[1]!;
    // …,ordered_qty,received_qty,unit_cost,line_total → trailing two cells blank.
    expect(row.endsWith('10,0,,')).toBe(true);
  });
});
