/**
 * QBO sandbox fixtures — a small, realistic QuickBooks dataset (vendors, items,
 * POs, bills, sales) plus a `FixtureTransport` that answers the Query API the way
 * Intuit's sandbox would.
 *
 * This is what makes the Wave 6.1 connect screen honest: the "sandbox preview"
 * runs the REAL `QboSourceAdapter` + `QboClient` + mappers against these rows, so
 * the cobalt chain forms from the same code path live OAuth will drive in Wave 6.2.
 * Tests reuse the same dataset so the preview and the assertions stay in lockstep.
 */

import type { QboRequest, QboResponse, QboTransport } from './transport';
import type { QboBill, QboItem, QboPurchaseOrder, QboSalesTxn, QboVendor } from './types';

const META = (t: string) => ({ CreateTime: t, LastUpdatedTime: t });

export const FIXTURE_VENDORS: QboVendor[] = [
  {
    Id: '56',
    DisplayName: 'Atchafalaya Distributing',
    Active: true,
    PrimaryEmailAddr: { Address: 'orders@atchafalaya-dist.example' },
    PrimaryPhone: { FreeFormNumber: '(985) 555-0142' },
    MetaData: META('2026-05-02T14:11:00-05:00'),
  },
  {
    Id: '57',
    DisplayName: 'Gulf Coast Components',
    Active: true,
    PrimaryEmailAddr: { Address: 'sales@gulfcoast-comp.example' },
    MetaData: META('2026-05-03T09:25:00-05:00'),
  },
  {
    Id: '58',
    DisplayName: 'Bayou Packaging Supply',
    Active: true,
    PrimaryPhone: { FreeFormNumber: '(504) 555-0188' },
    MetaData: META('2026-05-04T16:40:00-05:00'),
  },
  {
    Id: '59',
    DisplayName: 'Delta Fasteners (legacy)',
    Active: false,
    MetaData: META('2026-04-19T11:02:00-05:00'),
  },
];

export const FIXTURE_ITEMS: QboItem[] = [
  {
    Id: '101',
    Name: 'Cobalt Hex Bolt M8',
    Sku: 'CHB-0801',
    Type: 'Inventory',
    Active: true,
    PurchaseCost: 0.42,
    QtyOnHand: 4200,
    MetaData: META('2026-05-05T08:00:00-05:00'),
  },
  {
    Id: '102',
    Name: 'Stainless Washer 8mm',
    Sku: 'SSW-0820',
    Type: 'Inventory',
    Active: true,
    PurchaseCost: 0.08,
    QtyOnHand: 18000,
    MetaData: META('2026-05-05T08:05:00-05:00'),
  },
  {
    Id: '103',
    Name: 'Pallet Wrap 18in',
    Sku: 'PWR-1800',
    Type: 'Inventory',
    Active: true,
    PurchaseCost: 11.5,
    QtyOnHand: 320,
    MetaData: META('2026-05-06T10:00:00-05:00'),
  },
  {
    Id: '104',
    Name: 'Control Module CPR-2210',
    Sku: 'CPR-2210',
    Type: 'Inventory',
    Active: true,
    PurchaseCost: 84.0,
    QtyOnHand: 56,
    MetaData: META('2026-05-06T10:30:00-05:00'),
  },
  {
    Id: '105',
    Name: 'Reusable Tote 24L',
    Sku: 'RBH-4471',
    Type: 'Inventory',
    Active: true,
    PurchaseCost: 6.25,
    QtyOnHand: 940,
    MetaData: META('2026-05-07T13:15:00-05:00'),
  },
  // Non-inventory: must be SKIPPED by the mapper (not an error).
  {
    Id: '106',
    Name: 'Freight Surcharge',
    Type: 'Service',
    Active: true,
    MetaData: META('2026-05-07T13:20:00-05:00'),
  },
];

export const FIXTURE_PURCHASE_ORDERS: QboPurchaseOrder[] = [
  {
    Id: '301',
    DocNumber: 'PO-1001',
    VendorRef: { value: '56', name: 'Atchafalaya Distributing' },
    POStatus: 'Open',
    TotalAmt: 840.0,
    TxnDate: '2026-05-20',
    DueDate: '2026-05-28',
    Line: [
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        Amount: 420,
        ItemBasedExpenseLineDetail: { ItemRef: { value: '101' }, Qty: 1000, UnitPrice: 0.42 },
      },
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        Amount: 420,
        ItemBasedExpenseLineDetail: { ItemRef: { value: '104' }, Qty: 5, UnitPrice: 84 },
      },
    ],
    MetaData: META('2026-05-20T11:00:00-05:00'),
  },
  {
    Id: '302',
    DocNumber: 'PO-1002',
    VendorRef: { value: '58', name: 'Bayou Packaging Supply' },
    POStatus: 'Closed',
    TotalAmt: 1150.0,
    TxnDate: '2026-05-12',
    Line: [
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        Amount: 1150,
        ItemBasedExpenseLineDetail: { ItemRef: { value: '103' }, Qty: 100, UnitPrice: 11.5 },
      },
    ],
    MetaData: META('2026-05-18T09:30:00-05:00'),
  },
];

export const FIXTURE_BILLS: QboBill[] = [
  {
    Id: '401',
    VendorRef: { value: '58' },
    TxnDate: '2026-05-18',
    Line: [
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        ItemBasedExpenseLineDetail: { ItemRef: { value: '103' }, Qty: 100 },
      },
    ],
    MetaData: META('2026-05-18T15:00:00-05:00'),
  },
  {
    Id: '402',
    VendorRef: { value: '56' },
    TxnDate: '2026-05-22',
    Line: [
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        ItemBasedExpenseLineDetail: { ItemRef: { value: '101' }, Qty: 1000 },
      },
      {
        DetailType: 'ItemBasedExpenseLineDetail',
        ItemBasedExpenseLineDetail: { ItemRef: { value: '102' }, Qty: 5000 },
      },
    ],
    MetaData: META('2026-05-22T15:20:00-05:00'),
  },
];

export const FIXTURE_SALES: QboSalesTxn[] = [
  {
    Id: '501',
    TxnDate: '2026-05-23',
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '104' }, Qty: 3 },
      },
      {
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '105' }, Qty: 40 },
      },
      // A non-item subtotal line — must be skipped.
      { DetailType: 'SubTotalLineDetail' },
    ],
    MetaData: META('2026-05-23T17:00:00-05:00'),
  },
  {
    Id: '502',
    TxnDate: '2026-05-24',
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '101' }, Qty: 600 },
      },
    ],
    MetaData: META('2026-05-24T12:30:00-05:00'),
  },
];

const ROWS_BY_ENTITY: Record<string, unknown[]> = {
  Vendor: FIXTURE_VENDORS,
  Item: FIXTURE_ITEMS,
  PurchaseOrder: FIXTURE_PURCHASE_ORDERS,
  Bill: FIXTURE_BILLS,
  SalesReceipt: FIXTURE_SALES,
  Invoice: [], // none in the sandbox set; the adapter still walks the entity.
};

/**
 * A `QboTransport` that replays the fixture dataset. Parses the adapter's Query
 * statements (FROM / STARTPOSITION / MAXRESULTS) and paginates like the real API;
 * a `DocNumber` lookup returns empty (so a push creates), and a PO create echoes
 * back a new record. No network, no credentials — the real adapter code runs.
 */
export class FixtureTransport implements QboTransport {
  private created = 0;

  async request(req: QboRequest): Promise<QboResponse> {
    if (req.method === 'POST') {
      this.created += 1;
      return ok({
        PurchaseOrder: {
          Id: `9${this.created.toString().padStart(3, '0')}`,
          SyncToken: '0',
          MetaData: { CreateTime: '2026-06-05T00:00:00Z', LastUpdatedTime: '2026-06-05T00:00:00Z' },
        },
      });
    }

    const query = decodeURIComponent((req.url.split('query=')[1] ?? '').split('&')[0] ?? '');

    // PO round-trip lookup → no existing record in the sandbox set.
    if (/WHERE\s+DocNumber/i.test(query)) {
      return ok({ QueryResponse: {} });
    }

    const entity = query.match(/FROM\s+(\w+)/i)?.[1] ?? '';
    const start = Number(query.match(/STARTPOSITION\s+(\d+)/i)?.[1] ?? '1');
    const max = Number(query.match(/MAXRESULTS\s+(\d+)/i)?.[1] ?? '100');
    const all = ROWS_BY_ENTITY[entity] ?? [];
    const page = all.slice(start - 1, start - 1 + max);

    return ok({
      QueryResponse: {
        [entity]: page,
        startPosition: start,
        maxResults: page.length,
        totalCount: all.length,
      },
    });
  }
}

function ok(body: unknown): QboResponse {
  return { status: 200, headers: {}, body };
}
