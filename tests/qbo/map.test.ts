import { describe, expect, it } from 'vitest';
import {
  FIXTURE_BILLS,
  FIXTURE_ITEMS,
  FIXTURE_PURCHASE_ORDERS,
  FIXTURE_SALES,
  FIXTURE_VENDORS,
} from '@/lib/qbo/fixtures';
import {
  buildQboPurchaseOrder,
  mapBills,
  mapItems,
  mapPurchaseOrders,
  mapSalesTxns,
  mapVendors,
  poDocNumber,
} from '@/lib/qbo/map';
import type { CanonicalPayload } from '@/lib/source-adapter';

describe('mapItems', () => {
  it('maps inventory items and skips non-inventory (service) without erroring', () => {
    const { items, errors } = mapItems(FIXTURE_ITEMS);
    expect(errors).toHaveLength(0);
    // 6 fixtures, 1 is a Service line → skipped, not an error.
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.kind === 'product')).toBe(true);
  });

  it('maps cost, status, and stamps the schema version + watermark', () => {
    const first = mapItems([FIXTURE_ITEMS[0]!]).items[0]!;
    expect(first.attributes.sku).toBe('CHB-0801');
    expect(first.attributes.unitCost).toBe(0.42);
    expect(first.attributes.status).toBe('active');
    expect(first.schemaVersion).toBe(1);
    expect(first.externalUpdatedAt).toBe('2026-05-05T08:00:00-05:00');
  });

  it('falls back to Name when Sku is blank', () => {
    const p = mapItems([{ Id: '900', Name: 'Unskued Widget', Type: 'Inventory', Active: true }])
      .items[0]!;
    expect(p.attributes.sku).toBe('Unskued Widget');
  });

  it('marks an inactive item discontinued', () => {
    const p = mapItems([{ Id: '901', Name: 'Old', Sku: 'OLD-1', Type: 'Inventory', Active: false }])
      .items[0]!;
    expect(p.attributes.status).toBe('discontinued');
  });
});

describe('mapVendors', () => {
  it('maps display name, status, and compacted contact', () => {
    const { items, errors } = mapVendors(FIXTURE_VENDORS);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(4);

    const atch = items.find((s) => s.externalId === '56');
    expect(atch?.attributes.name).toBe('Atchafalaya Distributing');
    expect(atch?.attributes.contact).toEqual({
      email: 'orders@atchafalaya-dist.example',
      phone: '(985) 555-0142',
    });

    const legacy = items.find((s) => s.externalId === '59');
    expect(legacy?.attributes.status).toBe('archived');
  });

  it('reports a blank-name vendor as a schema error, not a throw', () => {
    const { items, errors } = mapVendors([{ Id: '77', DisplayName: '   ', Active: true }]);
    expect(items).toHaveLength(0);
    expect(errors[0]).toMatchObject({ externalId: '77', code: 'schema' });
  });
});

describe('mapPurchaseOrders', () => {
  it('maps vendor, status, and sequential item lines', () => {
    const { items, errors } = mapPurchaseOrders(FIXTURE_PURCHASE_ORDERS);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(2);

    const open = items.find((p) => p.externalId === '301');
    expect(open?.attributes.supplierExternalId).toBe('56');
    expect(open?.attributes.status).toBe('sent'); // QBO Open → sent
    expect(open?.attributes.lines).toHaveLength(2);
    expect(open?.attributes.lines[0]).toMatchObject({
      lineNo: 1,
      productExternalId: '101',
      orderedQty: 1000,
    });

    const closed = items.find((p) => p.externalId === '302');
    expect(closed?.attributes.status).toBe('closed'); // QBO Closed → closed
  });

  it('reports a PO with no item lines as a schema error (lines.min(1))', () => {
    const { items, errors } = mapPurchaseOrders([
      { Id: '999', VendorRef: { value: '56' }, POStatus: 'Open', Line: [] },
    ]);
    expect(items).toHaveLength(0);
    expect(errors[0]).toMatchObject({ externalId: '999', code: 'schema' });
  });
});

describe('mapBills + mapSalesTxns (stock movements)', () => {
  it('fans a bill into positive receipt movements, one per item line, with unique source refs', () => {
    const { items, errors } = mapBills(FIXTURE_BILLS);
    expect(errors).toHaveLength(0);
    // Bill 401 has 1 line, Bill 402 has 2 → 3 receipts.
    expect(items).toHaveLength(3);
    expect(items.every((m) => m.attributes.type === 'receipt')).toBe(true);
    expect(items.every((m) => m.attributes.quantity > 0)).toBe(true);
    const refs = items.map((m) => m.attributes.sourceRef);
    expect(new Set(refs).size).toBe(refs.length); // all unique
    expect(refs).toContain('qbo:bill:402:2');
  });

  it('fans a sales receipt into negative sale movements and skips non-item lines', () => {
    const { items, errors } = mapSalesTxns(FIXTURE_SALES);
    expect(errors).toHaveLength(0);
    // 501 has 2 item lines (+1 subtotal skipped), 502 has 1 → 3 sales.
    expect(items).toHaveLength(3);
    expect(items.every((m) => m.attributes.type === 'sale')).toBe(true);
    expect(items.every((m) => m.attributes.quantity < 0)).toBe(true);
    expect(items[0]!.attributes.occurredAt).toBe('2026-05-23T00:00:00.000Z');
  });

  it('pins occurred_at: date-only TxnDate → midnight UTC; a full datetime passes through verbatim', () => {
    const dateOnly = mapBills([
      {
        Id: '700',
        TxnDate: '2026-05-30',
        Line: [
          {
            DetailType: 'ItemBasedExpenseLineDetail',
            ItemBasedExpenseLineDetail: { ItemRef: { value: '101' }, Qty: 1 },
          },
        ],
      },
    ]).items[0]!;
    expect(dateOnly.attributes.occurredAt).toBe('2026-05-30T00:00:00.000Z');

    const withTime = mapBills([
      {
        Id: '701',
        TxnDate: '2026-05-30T13:45:00-05:00',
        Line: [
          {
            DetailType: 'ItemBasedExpenseLineDetail',
            ItemBasedExpenseLineDetail: { ItemRef: { value: '101' }, Qty: 1 },
          },
        ],
      },
    ]).items[0]!;
    expect(withTime.attributes.occurredAt).toBe('2026-05-30T13:45:00-05:00'); // preserved as-is
  });
});

describe('poDocNumber + buildQboPurchaseOrder (push)', () => {
  it('derives a deterministic, queryable DocNumber within QBO 21-char limit', () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const doc = poDocNumber(id);
    expect(doc).toBe(poDocNumber(id)); // deterministic
    expect(doc.length).toBeLessThanOrEqual(21);
    expect(doc).toMatch(/^TC-[0-9A-F]{12}$/);
  });

  it('builds a QBO PO body with vendor, lines, DocNumber, and round-trip note', () => {
    const payload: CanonicalPayload<'purchase_order'> = {
      kind: 'purchase_order',
      externalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      schemaVersion: 1,
      attributes: {
        supplierExternalId: '56',
        status: 'approved',
        lines: [{ lineNo: 1, productExternalId: '101', orderedQty: 1000, unitCost: 0.42 }],
      },
    };
    const body = buildQboPurchaseOrder(payload, 'tenant-123') as Record<string, unknown>;
    expect(body.VendorRef).toEqual({ value: '56' });
    expect(body.DocNumber).toBe(poDocNumber(payload.externalId));
    expect(body.PrivateNote).toContain('tenant=tenant-123');
    expect(body.PrivateNote).toContain(`po=${payload.externalId}`);
    const line = (body.Line as Array<Record<string, unknown>>)[0]!;
    expect(line.ItemBasedExpenseLineDetail).toMatchObject({
      ItemRef: { value: '101' },
      Qty: 1000,
      UnitPrice: 0.42,
    });
    expect(line.Amount).toBe(420);
  });
});
