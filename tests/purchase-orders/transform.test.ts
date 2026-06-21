import { describe, expect, it } from 'vitest';
import {
  buildOrderChain,
  committedValue,
  isApprovablePo,
  isOpenPo,
  isReceivablePo,
  mapPurchaseOrderRow,
  ORDER_STEPS,
  openPoCount,
  orderConnector,
  orderFrontier,
  type PoStatus,
  type PurchaseOrderListRow,
  poReference,
  poStatusLabel,
  type RawPurchaseOrderRow,
} from '@/lib/purchase-orders/transform';

const rawRow = (over: Partial<RawPurchaseOrderRow> = {}): RawPurchaseOrderRow => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  external_po_id: '301',
  external_reference: 'PO-1001',
  supplier_id: 'sup-1',
  status: 'sent',
  recommended_by: 'external',
  total: 840,
  expected_delivery_at: '2026-05-28T00:00:00.000Z',
  actual_delivery_at: null,
  updated_at: '2026-05-20T11:00:00.000Z',
  suppliers: { name: 'Atchafalaya Distributing' },
  purchase_order_lines: [{ count: 2 }],
  ...over,
});

const listRow = (over: Partial<PurchaseOrderListRow> = {}): PurchaseOrderListRow => ({
  id: 'po-1',
  externalPoId: '301',
  reference: 'PO-1001',
  supplierId: 'sup-1',
  supplierName: 'Atchafalaya Distributing',
  status: 'sent',
  recommendedBy: 'external',
  lineCount: 2,
  total: 840,
  expectedDeliveryAt: '2026-05-28T00:00:00.000Z',
  actualDeliveryAt: null,
  updatedAt: '2026-05-20T11:00:00.000Z',
  ...over,
});

describe('mapPurchaseOrderRow', () => {
  it('flattens the embedded supplier name and line count', () => {
    const row = mapPurchaseOrderRow(rawRow());
    expect(row.supplierName).toBe('Atchafalaya Distributing');
    expect(row.lineCount).toBe(2);
    expect(row.reference).toBe('PO-1001');
    expect(row.status).toBe('sent');
  });

  it('survives a missing supplier embed and empty line-count array', () => {
    const row = mapPurchaseOrderRow(rawRow({ suppliers: null, purchase_order_lines: [] }));
    expect(row.supplierName).toBe('Unknown supplier');
    expect(row.lineCount).toBe(0);
  });
});

describe('poReference', () => {
  it('prefers the DocNumber', () => {
    expect(poReference('PO-1001', '301', 'abcdef12-...')).toBe('PO-1001');
  });
  it('falls back to the QBO entity id, then the internal id', () => {
    expect(poReference(null, '301', 'abcdef12-3456')).toBe('QBO #301');
    expect(poReference('   ', null, 'abcdef12-3456')).toBe('PO abcdef12');
  });
});

describe('orderFrontier', () => {
  const cases: [PoStatus, number][] = [
    ['draft', 1],
    ['recommended', 1],
    ['approved', 1],
    ['exported', 2],
    ['sent', 2],
    ['partial_received', 3],
    ['received', ORDER_STEPS.length],
    ['closed', ORDER_STEPS.length],
    ['canceled', 1],
  ];
  it.each(cases)('%s → frontier %i', (status, frontier) => {
    expect(orderFrontier(status)).toBe(frontier);
  });
});

describe('buildOrderChain', () => {
  it('an open (sent) PO has SUPPLIER + ORDERED done and IN TRANSIT igniting', () => {
    const chain = buildOrderChain({
      status: 'sent',
      supplierName: 'Atchafalaya',
      reference: 'PO-1001',
      expectedDeliveryAt: '2026-05-28T00:00:00.000Z',
      actualDeliveryAt: null,
    });
    expect(chain.map((s) => s.state)).toEqual(['done', 'done', 'active', 'pending']);
    expect(chain[0]?.label).toBe('Atchafalaya');
    expect(chain[1]?.label).toBe('PO-1001');
    expect(chain[2]?.when).toBe('due May 28');
  });

  it('a received/closed PO lights every link', () => {
    const chain = buildOrderChain({
      status: 'closed',
      supplierName: 'Bayou',
      reference: 'PO-1002',
      expectedDeliveryAt: null,
      actualDeliveryAt: '2026-05-18T00:00:00.000Z',
    });
    expect(chain.every((s) => s.state === 'done')).toBe(true);
    expect(chain[3]?.when).toBe('May 18');
  });

  it('a canceled PO shows only SUPPLIER and surfaces Canceled at the tail', () => {
    const chain = buildOrderChain({
      status: 'canceled',
      supplierName: 'Gulf',
      reference: 'PO-9',
      expectedDeliveryAt: null,
      actualDeliveryAt: null,
    });
    expect(chain.map((s) => s.state)).toEqual(['done', 'pending', 'pending', 'pending']);
    expect(chain[3]?.label).toBe('Canceled');
  });
});

describe('orderConnector', () => {
  it('cobalt after a done link, pewter otherwise, none on the last', () => {
    expect(orderConnector('done', false)).toBe('cobalt');
    expect(orderConnector('active', false)).toBe('pewter');
    expect(orderConnector('done', true)).toBe('none');
  });
});

describe('open / committed aggregates', () => {
  it('isOpenPo is true until received/closed/canceled', () => {
    expect(isOpenPo('sent')).toBe(true);
    expect(isOpenPo('partial_received')).toBe(true);
    expect(isOpenPo('received')).toBe(false);
    expect(isOpenPo('closed')).toBe(false);
    expect(isOpenPo('canceled')).toBe(false);
  });

  it('approvable vs receivable partition the in-flight statuses (Block 11b)', () => {
    // A draft awaits approval; once placed it awaits receipt; the two never overlap.
    expect(isApprovablePo('draft')).toBe(true);
    expect(isApprovablePo('recommended')).toBe(true);
    expect(isApprovablePo('sent')).toBe(false);
    expect(isReceivablePo('sent')).toBe(true);
    expect(isReceivablePo('exported')).toBe(true);
    expect(isReceivablePo('partial_received')).toBe(true);
    expect(isReceivablePo('draft')).toBe(false);
    expect(isReceivablePo('received')).toBe(false);
  });

  it('counts only open POs and sums their totals', () => {
    const rows = [
      listRow({ status: 'sent', total: 840 }),
      listRow({ status: 'partial_received', total: 200 }),
      listRow({ status: 'closed', total: 1150 }),
      listRow({ status: 'canceled', total: 99 }),
      listRow({ status: 'sent', total: null }),
    ];
    expect(openPoCount(rows)).toBe(3);
    expect(committedValue(rows)).toBe(1040);
  });
});

describe('poStatusLabel', () => {
  it('maps sent to the operator word "Open"', () => {
    expect(poStatusLabel('sent')).toBe('Open');
    expect(poStatusLabel('partial_received')).toBe('Partial');
    expect(poStatusLabel('canceled')).toBe('Canceled');
  });
});
