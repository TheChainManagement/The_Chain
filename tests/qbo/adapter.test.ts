import { describe, expect, it } from 'vitest';
import { QboSourceAdapter } from '@/lib/qbo/adapter';
import { QboClient } from '@/lib/qbo/client';
import { FixtureTransport } from '@/lib/qbo/fixtures';
import { FatalError } from '@/lib/source-adapter';
import type { Cursor, PullResult } from '@/lib/source-adapter';
import type { QboRequest, QboResponse, QboTransport } from '@/lib/qbo/transport';

function adapter(pageSize?: number, transport: QboTransport = new FixtureTransport()): QboSourceAdapter {
  const client = new QboClient({ realmId: '900', environment: 'sandbox' }, transport);
  return new QboSourceAdapter(client, 'tenant-123', pageSize);
}

describe('QboSourceAdapter.pull — single-entity kinds', () => {
  it('pulls products from the fixture set (inventory only) with no next cursor', async () => {
    const res = await adapter().pull('product', null, 'k1');
    expect(res.items).toHaveLength(5); // service item skipped
    expect(res.nextCursor).toBeNull();
    expect(res.errors).toHaveLength(0);
  });

  it('paginates by STARTPOSITION when a page is full', async () => {
    const a = adapter(2);
    const first = await a.pull('supplier', null, 'k1');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor?.raw).toMatchObject({ startPosition: 3 });

    const second = await a.pull('supplier', first.nextCursor, 'k1');
    expect(second.items).toHaveLength(2); // vendors 3 & 4 (a full page)
    // A full page can't prove the end, so the adapter advances once more.
    expect(second.nextCursor?.raw).toMatchObject({ startPosition: 5 });

    const third = await a.pull('supplier', second.nextCursor, 'k1');
    expect(third.items).toHaveLength(0); // empty page proves exhaustion
    expect(third.nextCursor).toBeNull();
  });

  it('carries a high-watermark forward across pages', async () => {
    const first = await adapter(2).pull('supplier', null, 'k1');
    expect(first.nextCursor?.highWatermark).toBeTruthy();
  });

  it('pulls purchase orders with mapped lines', async () => {
    const res = await adapter().pull('purchase_order', null, 'k1');
    expect(res.items).toHaveLength(2);
    expect(res.items[0]!.attributes.lines.length).toBeGreaterThan(0);
  });

  it('throws FatalError(unsupported_kind) for a kind QBO does not read', async () => {
    await expect(adapter().pull('inventory_level', null, 'k1')).rejects.toMatchObject({
      name: 'FatalError',
      code: 'unsupported_kind',
    });
  });
});

describe('QboSourceAdapter.pull — stock_movement walks Bill → SalesReceipt → Invoice', () => {
  it('advances the cursor across entities and ends after Invoice', async () => {
    const a = adapter(); // default page size; each entity returns < page → single page each
    const bills = await a.pull('stock_movement', null, 'k1');
    expect(bills.items.every((m) => m.attributes.type === 'receipt')).toBe(true);
    expect((bills.nextCursor?.raw as { entity: string }).entity).toBe('SalesReceipt');

    const sales = await a.pull('stock_movement', bills.nextCursor, 'k1');
    expect(sales.items.every((m) => m.attributes.type === 'sale')).toBe(true);
    expect((sales.nextCursor?.raw as { entity: string }).entity).toBe('Invoice');

    const invoices = await a.pull('stock_movement', sales.nextCursor, 'k1');
    expect(invoices.items).toHaveLength(0); // no invoices in the sandbox set
    expect(invoices.nextCursor).toBeNull(); // walk complete
  });

  it('produces signed quantities (receipts positive, sales negative)', async () => {
    const a = adapter();
    const bills = await a.pull('stock_movement', null, 'k1');
    const sales = await a.pull('stock_movement', bills.nextCursor, 'k1');
    expect(bills.items.every((m) => m.attributes.quantity > 0)).toBe(true);
    expect(sales.items.every((m) => m.attributes.quantity < 0)).toBe(true);
  });
});

/**
 * A transport that — unlike the sandbox FixtureTransport — actually honors the
 * `WHERE Metadata.LastUpdatedTime > 'floor'` clause. This is what catches the
 * cursor-drop bug: if the adapter advanced the watermark into the filter while
 * paginating, page 2's filtered set would shift and rows would vanish.
 */
class FilteringVendorTransport implements QboTransport {
  constructor(private readonly vendors: Array<{ Id: string; ts: string }>) {}
  async request(req: QboRequest): Promise<QboResponse> {
    const query = decodeURIComponent((req.url.split('query=')[1] ?? '').split('&')[0] ?? '');
    const floor = query.match(/LastUpdatedTime > '([^']+)'/)?.[1];
    const start = Number(query.match(/STARTPOSITION (\d+)/)?.[1] ?? '1');
    const max = Number(query.match(/MAXRESULTS (\d+)/)?.[1] ?? '100');
    const filtered = this.vendors
      .filter((v) => !floor || v.ts > floor)
      .sort((a, b) => a.Id.localeCompare(b.Id));
    const page = filtered.slice(start - 1, start - 1 + max).map((v) => ({
      Id: v.Id,
      DisplayName: `Vendor ${v.Id}`,
      Active: true,
      MetaData: { LastUpdatedTime: v.ts },
    }));
    return { status: 200, headers: {}, body: { QueryResponse: { Vendor: page } } };
  }
}

describe('QboSourceAdapter.pull — pagination is lossless under an incremental floor', () => {
  it('returns every row above the floor without dropping mid-pagination (regression)', async () => {
    const vendors = [
      { Id: '01', ts: '2026-05-01T00:00:00Z' },
      { Id: '02', ts: '2026-05-02T00:00:00Z' },
      { Id: '03', ts: '2026-05-03T00:00:00Z' },
      { Id: '04', ts: '2026-05-04T00:00:00Z' },
      { Id: '05', ts: '2026-05-05T00:00:00Z' },
    ];
    const a = adapter(2, new FilteringVendorTransport(vendors));
    // Floor at V01 → expect V02..V05 (4 rows), paginated 2 at a time.
    const floor = '2026-05-01T00:00:00Z';
    const seen: string[] = [];
    let cursor: Cursor | null = { raw: { startPosition: 1, floor }, highWatermark: floor };
    for (let i = 0; i < 10; i++) {
      const res: PullResult = await a.pull('supplier', cursor, 'k1');
      seen.push(...res.items.map((it) => it.externalId));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    expect(seen).toEqual(['02', '03', '04', '05']); // none dropped
    expect(new Set(seen).size).toBe(seen.length); // none duplicated
  });
});

describe('QboSourceAdapter.push — PO write-back idempotency', () => {
  const poPayload = {
    kind: 'purchase_order' as const,
    externalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    schemaVersion: 1,
    attributes: {
      supplierExternalId: '56',
      status: 'approved' as const,
      lines: [{ lineNo: 1, productExternalId: '101', orderedQty: 1000, unitCost: 0.42 }],
    },
  };

  it('creates the PO when no round-trip match exists', async () => {
    const res = await adapter().push('purchase_order', poPayload, 'k1');
    expect(res.externalId).toMatch(/^9/); // FixtureTransport echoes a created id
    expect(res.appliedAt).toBeTruthy();
  });

  it('returns the existing PO without creating a duplicate when DocNumber already exists', async () => {
    let creates = 0;
    const transport: QboTransport = {
      async request(req: QboRequest): Promise<QboResponse> {
        if (req.method === 'POST') {
          creates += 1;
          return { status: 200, headers: {}, body: { PurchaseOrder: { Id: 'NEW', SyncToken: '0' } } };
        }
        // The round-trip lookup finds an existing PO.
        return {
          status: 200,
          headers: {},
          body: { QueryResponse: { PurchaseOrder: [{ Id: '301', SyncToken: '4' }] } },
        };
      },
    };
    const res = await adapter(undefined, transport).push('purchase_order', poPayload, 'k1');
    expect(res.externalId).toBe('301');
    expect(res.externalVersion).toBe(4);
    expect(creates).toBe(0); // never created a duplicate
  });

  it('rejects a non-PO push kind', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard for an out-of-contract kind
      adapter().push('product', poPayload, 'k1'),
    ).rejects.toBeInstanceOf(FatalError);
  });
});
