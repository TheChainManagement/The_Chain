/**
 * QBO → canonical mapping (pure, isomorphic, no I/O).
 *
 * Every function takes an untrusted QBO entity and returns canonical payloads +
 * per-record errors. The canonical Zod schema is the final authority: a value
 * that reads but violates the schema (blank name, negative cost) is reported as
 * a `schema` error, not thrown, so one bad record can't sink a whole pull. This
 * mirrors the Block 5 `mapRows` contract on the QBO side of the same seam.
 *
 * Sign convention (matches the CSV writer): sales are negative, receipts
 * positive. One Bill/SalesReceipt fans out to one movement per item line.
 */

import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalPayload,
  canonical,
  type EntityKind,
  type PullResultError,
} from '@/lib/source-adapter';
import type {
  QboBill,
  QboItem,
  QboItemExpenseLine,
  QboPurchaseOrder,
  QboSalesLine,
  QboSalesTxn,
  QboVendor,
} from './types';

export interface MapResult<E extends EntityKind> {
  items: CanonicalPayload<E>[];
  errors: PullResultError[];
}

const ITEM_LINE = 'ItemBasedExpenseLineDetail';
const SALES_LINE = 'SalesItemLineDetail';

// ----- shared helpers -----

/** Validate canonical attributes; produce a payload or a `schema` error. */
function validate<E extends EntityKind>(
  kind: E,
  externalId: string,
  attributes: unknown,
  externalUpdatedAt?: string,
): { payload: CanonicalPayload<E> | null; error: PullResultError | null } {
  const schema = canonical.canonicalSchemasByKind[kind];
  const parsed = schema.safeParse(attributes);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join('.') || 'record';
    return {
      payload: null,
      error: {
        externalId,
        code: 'schema',
        message: `${where}: ${first?.message ?? 'failed validation'}`,
      },
    };
  }
  return {
    payload: {
      kind,
      externalId,
      externalUpdatedAt,
      attributes: parsed.data as CanonicalPayload<E>['attributes'],
      schemaVersion: CANONICAL_SCHEMA_VERSION,
    },
    error: null,
  };
}

/** QBO TxnDate is date-only (YYYY-MM-DD); normalize to an ISO instant. */
function toIso(date: string | undefined): string {
  if (!date) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : date;
}

/** Drop undefined/empty values so canonical `contact` stays tidy. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

// ----- Item → product -----

export function mapItems(items: QboItem[]): MapResult<'product'> {
  const out: CanonicalPayload<'product'>[] = [];
  const errors: PullResultError[] = [];

  for (const item of items) {
    // Only stock items become products; services/non-inventory are skipped (not errors).
    if (item.Type && item.Type !== 'Inventory') continue;

    const sku = (item.Sku ?? '').trim() || item.Name;
    const { payload, error } = validate(
      'product',
      item.Id,
      compact({
        sku,
        name: item.Name,
        description: item.Description,
        status: item.Active === false ? 'discontinued' : 'active',
        unitCost: typeof item.PurchaseCost === 'number' ? item.PurchaseCost : undefined,
      }),
      item.MetaData?.LastUpdatedTime,
    );
    if (payload) out.push(payload);
    if (error) errors.push(error);
  }

  return { items: out, errors };
}

// ----- Vendor → supplier -----

export function mapVendors(vendors: QboVendor[]): MapResult<'supplier'> {
  const out: CanonicalPayload<'supplier'>[] = [];
  const errors: PullResultError[] = [];

  for (const v of vendors) {
    const name = (v.DisplayName ?? v.CompanyName ?? '').trim();
    const { payload, error } = validate(
      'supplier',
      v.Id,
      {
        name,
        status: v.Active === false ? 'archived' : 'active',
        contact: compact({
          email: v.PrimaryEmailAddr?.Address,
          phone: v.PrimaryPhone?.FreeFormNumber,
          web: v.WebAddr?.URI,
        }),
      },
      v.MetaData?.LastUpdatedTime,
    );
    if (payload) out.push(payload);
    if (error) errors.push(error);
  }

  return { items: out, errors };
}

// ----- PurchaseOrder → purchase_order -----

const PO_STATUS: Record<string, canonical.PurchaseOrderAttributes['status']> = {
  Open: 'sent',
  Closed: 'closed',
};

export function mapPurchaseOrders(orders: QboPurchaseOrder[]): MapResult<'purchase_order'> {
  const out: CanonicalPayload<'purchase_order'>[] = [];
  const errors: PullResultError[] = [];

  for (const po of orders) {
    const supplierExternalId = po.VendorRef?.value ?? '';
    const lines = (po.Line ?? [])
      .filter((l) => l.DetailType === ITEM_LINE && l.ItemBasedExpenseLineDetail?.ItemRef?.value)
      .map((l, i) => {
        const d = l.ItemBasedExpenseLineDetail;
        return {
          lineNo: i + 1,
          productExternalId: d?.ItemRef?.value ?? '',
          orderedQty: typeof d?.Qty === 'number' ? d.Qty : 0,
          ...(typeof d?.UnitPrice === 'number' ? { unitCost: d.UnitPrice } : {}),
        };
      });

    const { payload, error } = validate(
      'purchase_order',
      po.Id,
      compact({
        supplierExternalId,
        status: PO_STATUS[po.POStatus ?? 'Open'] ?? 'sent',
        total: typeof po.TotalAmt === 'number' ? po.TotalAmt : undefined,
        expectedDeliveryAt: po.DueDate ? toIso(po.DueDate) : undefined,
        lines,
      }),
      po.MetaData?.LastUpdatedTime,
    );
    if (payload) out.push(payload);
    if (error) errors.push(error);
  }

  return { items: out, errors };
}

// ----- Bill / SalesTxn → stock_movement[] -----

function lineQty(qty: number | undefined): number | null {
  return typeof qty === 'number' && Number.isFinite(qty) ? qty : null;
}

/** Bills are received purchases: each item line is a positive `receipt`. */
export function mapBills(bills: QboBill[]): MapResult<'stock_movement'> {
  const out: CanonicalPayload<'stock_movement'>[] = [];
  const errors: PullResultError[] = [];

  for (const bill of bills) {
    const occurredAt = toIso(bill.TxnDate);
    (bill.Line ?? []).forEach((line: QboItemExpenseLine, i) => {
      const d = line.ItemBasedExpenseLineDetail;
      const qty = lineQty(d?.Qty);
      if (!d?.ItemRef?.value || qty === null) return; // non-item line, skip
      const { payload, error } = validate('stock_movement', `${bill.Id}:${i + 1}`, {
        productExternalId: d.ItemRef.value,
        type: 'receipt',
        quantity: Math.abs(qty),
        occurredAt,
        sourceRef: `qbo:bill:${bill.Id}:${i + 1}`,
      });
      if (payload) out.push(payload);
      if (error) errors.push(error);
    });
  }

  return { items: out, errors };
}

/** Sales receipts / invoices reduce stock: each item line is a negative `sale`. */
export function mapSalesTxns(txns: QboSalesTxn[]): MapResult<'stock_movement'> {
  const out: CanonicalPayload<'stock_movement'>[] = [];
  const errors: PullResultError[] = [];

  for (const txn of txns) {
    const occurredAt = toIso(txn.TxnDate);
    (txn.Line ?? []).forEach((line: QboSalesLine, i) => {
      const d = line.SalesItemLineDetail;
      const qty = lineQty(d?.Qty);
      if (line.DetailType !== SALES_LINE || !d?.ItemRef?.value || qty === null) return;
      const { payload, error } = validate('stock_movement', `${txn.Id}:${i + 1}`, {
        productExternalId: d.ItemRef.value,
        type: 'sale',
        quantity: -Math.abs(qty),
        occurredAt,
        sourceRef: `qbo:sales:${txn.Id}:${i + 1}`,
      });
      if (payload) out.push(payload);
      if (error) errors.push(error);
    });
  }

  return { items: out, errors };
}

// ----- push: canonical PO → QBO PurchaseOrder body + round-trip identity -----

/**
 * Deterministic, queryable round-trip token derived from The Chain's internal PO
 * id. Stamped on the QBO PurchaseOrder's `DocNumber` (max 21 chars) so a retried
 * push finds the existing record by `WHERE DocNumber = ?` and never duplicates.
 */
export function poDocNumber(internalPoId: string): string {
  const hex = internalPoId.replace(/-/g, '').slice(-12).toUpperCase();
  return `TC-${hex}`;
}

/** Build the QBO PurchaseOrder create body from a canonical PO payload. */
export function buildQboPurchaseOrder(
  payload: CanonicalPayload<'purchase_order'>,
  tenantId: string,
): Record<string, unknown> {
  const a = payload.attributes;
  return {
    DocNumber: poDocNumber(payload.externalId),
    VendorRef: { value: a.supplierExternalId },
    // Full ids live in the note for human + audit round-trip; the queryable
    // identity is DocNumber above.
    PrivateNote: `chain:tenant=${tenantId};po=${payload.externalId}`,
    Line: a.lines.map((l) => ({
      DetailType: ITEM_LINE,
      Amount: l.unitCost != null ? l.orderedQty * l.unitCost : undefined,
      ItemBasedExpenseLineDetail: {
        ItemRef: { value: l.productExternalId },
        Qty: l.orderedQty,
        ...(l.unitCost != null ? { UnitPrice: l.unitCost } : {}),
      },
    })),
  };
}
