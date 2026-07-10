/**
 * Purchase-order presentation logic (Block 6, Wave 6.3-A) — pure, no I/O.
 *
 * The cockpit and the supplier-detail panel both read POs through here: the
 * raw PostgREST row is mapped to a flat `PurchaseOrderListRow`, and the order's
 * progress becomes the visible chain (SUPPLIER → ORDERED → IN TRANSIT →
 * RECEIVED) via `buildOrderChain`. Keeping the stage logic pure means the chain
 * the operator watches is unit-tested, not eyeballed.
 */

export type PoStatus =
  | 'draft'
  | 'recommended'
  | 'approved'
  | 'exported'
  | 'sent'
  | 'partial_received'
  | 'received'
  | 'closed'
  | 'canceled';

export type PoRecommendedBy = 'system' | 'user' | 'external';

/** A link state, matching ChainLink's contract without importing the component. */
export type OrderChainState = 'done' | 'active' | 'pending';

export const ORDER_STEPS = ['SUPPLIER', 'ORDERED', 'IN TRANSIT', 'RECEIVED'] as const;

export interface OrderChainStep {
  step: string;
  label: string;
  when?: string;
  state: OrderChainState;
}

// ----- row mapping -----

export interface RawPurchaseOrderRow {
  id: string;
  external_po_id: string | null;
  external_reference: string | null;
  supplier_id: string;
  status: PoStatus;
  recommended_by: PoRecommendedBy;
  total: number | null;
  expected_delivery_at: string | null;
  actual_delivery_at: string | null;
  updated_at: string;
  suppliers: { name: string } | null;
  purchase_order_lines: { count: number }[] | null;
}

export interface PurchaseOrderListRow {
  id: string;
  externalPoId: string | null;
  reference: string;
  supplierId: string;
  supplierName: string;
  status: PoStatus;
  recommendedBy: PoRecommendedBy;
  lineCount: number;
  total: number | null;
  expectedDeliveryAt: string | null;
  actualDeliveryAt: string | null;
  updatedAt: string;
}

/* ----- PO detail (Block 10 receive surface) ----- */

export interface RawPurchaseOrderLine {
  line_no: number;
  product_id: string;
  ordered_qty: number | string;
  received_qty: number | string;
  unit_cost: number | string | null;
  products: {
    sku: string | null;
    name: string | null;
    unit_of_measure: string | null;
    // Every supplier link for the product rides the embed; the mapper picks
    // the row matching the PO's supplier (PostgREST can't filter a nested
    // embed against a parent column).
    product_suppliers:
      | {
          supplier_id: string;
          purchase_uom: string | null;
          purchase_to_stock_factor: number | string | null;
        }[]
      | null;
  } | null;
}

export interface RawPurchaseOrderDetail extends Omit<RawPurchaseOrderRow, 'purchase_order_lines'> {
  created_at: string;
  purchase_order_lines: RawPurchaseOrderLine[] | null;
}

export interface PurchaseOrderLine {
  lineNo: number;
  productId: string;
  sku: string;
  name: string;
  /** In PURCHASE UoM when a conversion factor is set (W2-2.5). */
  orderedQty: number;
  receivedQty: number;
  /** Per purchase unit when a factor is set. */
  unitCost: number | null;
  /** The product's canonical stock unit (what the ledger counts). */
  stockUom: string | null;
  /** The unit this supplier sells in; null = same as the stock unit. */
  purchaseUom: string | null;
  /** 1 purchase unit = this many stock units; null = 1. */
  purchaseToStockFactor: number | null;
}

export interface PurchaseOrderDetail extends PurchaseOrderListRow {
  createdAt: string;
  lines: PurchaseOrderLine[];
}

export function mapPurchaseOrderDetail(raw: RawPurchaseOrderDetail): PurchaseOrderDetail {
  const lines = (raw.purchase_order_lines ?? [])
    .map((l) => {
      const link = (l.products?.product_suppliers ?? []).find(
        (ps) => ps.supplier_id === raw.supplier_id,
      );
      return {
        lineNo: l.line_no,
        productId: l.product_id,
        sku: l.products?.sku ?? '—',
        name: l.products?.name ?? '—',
        orderedQty: Number(l.ordered_qty),
        receivedQty: Number(l.received_qty),
        unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
        stockUom: l.products?.unit_of_measure ?? null,
        purchaseUom: link?.purchase_uom ?? null,
        purchaseToStockFactor:
          link?.purchase_to_stock_factor == null ? null : Number(link.purchase_to_stock_factor),
      };
    })
    .sort((a, b) => a.lineNo - b.lineNo);

  return {
    id: raw.id,
    externalPoId: raw.external_po_id,
    reference: poReference(raw.external_reference, raw.external_po_id, raw.id),
    supplierId: raw.supplier_id,
    supplierName: raw.suppliers?.name ?? 'Unknown supplier',
    status: raw.status,
    recommendedBy: raw.recommended_by,
    lineCount: lines.length,
    total: raw.total,
    expectedDeliveryAt: raw.expected_delivery_at,
    actualDeliveryAt: raw.actual_delivery_at,
    updatedAt: raw.updated_at,
    createdAt: raw.created_at,
    lines,
  };
}

export function mapPurchaseOrderRow(raw: RawPurchaseOrderRow): PurchaseOrderListRow {
  return {
    id: raw.id,
    externalPoId: raw.external_po_id,
    reference: poReference(raw.external_reference, raw.external_po_id, raw.id),
    supplierId: raw.supplier_id,
    supplierName: raw.suppliers?.name ?? 'Unknown supplier',
    status: raw.status,
    recommendedBy: raw.recommended_by,
    lineCount: raw.purchase_order_lines?.[0]?.count ?? 0,
    total: raw.total,
    expectedDeliveryAt: raw.expected_delivery_at,
    actualDeliveryAt: raw.actual_delivery_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * The operator-facing PO label. Prefer the source DocNumber ("PO-1001"); fall
 * back to a short slug of the QBO entity id, then the internal id, so a row is
 * never blank.
 */
export function poReference(
  externalReference: string | null,
  externalPoId: string | null,
  internalId: string,
): string {
  if (externalReference?.trim()) return externalReference.trim();
  if (externalPoId?.trim()) return `QBO #${externalPoId.trim()}`;
  return `PO ${internalId.slice(0, 8)}`;
}

// ----- status semantics -----

const STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft',
  recommended: 'Recommended',
  approved: 'Approved',
  exported: 'Exported',
  sent: 'Open',
  partial_received: 'Partial',
  received: 'Received',
  closed: 'Closed',
  canceled: 'Canceled',
};

export function poStatusLabel(status: PoStatus): string {
  return STATUS_LABEL[status];
}

/** Open = still in flight (not received, closed, or canceled). */
export function isOpenPo(status: PoStatus): boolean {
  return status !== 'received' && status !== 'closed' && status !== 'canceled';
}

/** Approvable = a draft awaiting placement (Block 11b approve action). */
export function isApprovablePo(status: PoStatus): boolean {
  return status === 'draft' || status === 'recommended';
}

/** Receivable = placed and not yet fully in (the receive surface applies). */
export function isReceivablePo(status: PoStatus): boolean {
  return status === 'sent' || status === 'exported' || status === 'partial_received';
}

export function openPoCount(rows: PurchaseOrderListRow[]): number {
  return rows.filter((r) => isOpenPo(r.status)).length;
}

/** Committed value = sum of totals across the OPEN orders (capital in flight). */
export function committedValue(rows: PurchaseOrderListRow[]): number {
  return rows.reduce((sum, r) => (isOpenPo(r.status) ? sum + (r.total ?? 0) : sum), 0);
}

// ----- the order chain -----

/**
 * The frontier is the index of the IN-PROGRESS step; steps before it are done,
 * after it are pending. A fully-received order returns `ORDER_STEPS.length`
 * (every link done). A placed order is always at least at ORDERED, so SUPPLIER
 * reads done.
 */
export function orderFrontier(status: PoStatus): number {
  switch (status) {
    case 'draft':
    case 'recommended':
    case 'approved':
      return 1; // supplier chosen; placing the order
    case 'exported':
    case 'sent':
      return 2; // ordered; waiting on the supplier
    case 'partial_received':
      return 3; // part of it landed; completing
    case 'received':
    case 'closed':
      return ORDER_STEPS.length; // fully received — every link done
    case 'canceled':
      return 1; // overridden below; the badge carries the canceled meaning
  }
}

function stepState(index: number, frontier: number, canceled: boolean): OrderChainState {
  if (canceled) return index === 0 ? 'done' : 'pending';
  if (index < frontier) return 'done';
  if (index === frontier) return 'active';
  return 'pending';
}

export interface OrderChainInput {
  status: PoStatus;
  supplierName: string;
  reference: string;
  expectedDeliveryAt: string | null;
  actualDeliveryAt: string | null;
}

export function buildOrderChain(input: OrderChainInput): OrderChainStep[] {
  const canceled = input.status === 'canceled';
  const frontier = orderFrontier(input.status);

  const labels: Record<(typeof ORDER_STEPS)[number], { label: string; when?: string }> = {
    SUPPLIER: { label: input.supplierName },
    ORDERED: { label: input.reference },
    'IN TRANSIT': {
      label: 'In transit',
      when: input.expectedDeliveryAt ? `due ${fmtDate(input.expectedDeliveryAt)}` : undefined,
    },
    RECEIVED: {
      label: canceled ? 'Canceled' : 'Received',
      when: input.actualDeliveryAt ? fmtDate(input.actualDeliveryAt) : undefined,
    },
  };

  return ORDER_STEPS.map((step, i) => ({
    step,
    label: labels[step].label,
    when: labels[step].when,
    state: stepState(i, frontier, canceled),
  }));
}

/** A done link connects cobalt to the next; an unformed link stays pewter. */
export function orderConnector(
  state: OrderChainState,
  isLast: boolean,
): 'cobalt' | 'pewter' | 'none' {
  if (isLast) return 'none';
  return state === 'done' ? 'cobalt' : 'pewter';
}

// ----- formatting -----

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Short calendar date ("May 28"). ISO in → label out; deterministic by UTC. */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
