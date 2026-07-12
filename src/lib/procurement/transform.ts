/**
 * W2-3 procurement — pure logic for the RFQ bench (slice 2).
 * Validation, status transitions, the RFQ status chain, and the per-vendor
 * export CSV. No I/O: queries live in queries.ts, writes in the Server Actions.
 * Design contract: docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md §5/§6.
 */

export type RfqStatus = 'draft' | 'sent' | 'quoted' | 'closed' | 'canceled';

export const PERMISSION_MESSAGE = 'You do not have permission to work quote requests.';

/** Roles that may create/edit/send RFQs (mirrors the RLS write set). */
export const RFQ_WRITER_ROLES: ReadonlySet<string> = new Set(['owner', 'manager', 'planner']);

// ---------- validation ----------

export type Validation = { ok: true } | { ok: false; error: string };

export function validateRfqInput(input: { title: string; locationId: string }): Validation {
  if (!input.title.trim()) {
    return { ok: false, error: 'Give the quote request a title vendors will recognize.' };
  }
  if (input.title.trim().length > 120) {
    return { ok: false, error: 'Keep the title under 120 characters.' };
  }
  if (!input.locationId.trim()) {
    return { ok: false, error: 'Pick the location this quote request buys for.' };
  }
  return { ok: true };
}

export function validateLineQty(
  raw: string,
): { ok: true; qty: number } | { ok: false; error: string } {
  const qty = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(qty)) {
    return { ok: false, error: 'Enter the quantity to request.' };
  }
  if (qty <= 0) {
    return { ok: false, error: 'Quantity must be greater than zero.' };
  }
  return { ok: true, qty };
}

// ---------- status transitions (design §5) ----------

/** Send = draft only, and only with at least one line and one vendor. */
export function canSend(status: RfqStatus, lineCount: number, vendorCount: number): Validation {
  if (status !== 'draft') {
    return { ok: false, error: 'This quote request has already gone out.' };
  }
  if (lineCount === 0) {
    return { ok: false, error: 'Add at least one line before sending.' };
  }
  if (vendorCount === 0) {
    return { ok: false, error: 'Pick at least one vendor before sending.' };
  }
  return { ok: true };
}

export function canClose(status: RfqStatus): Validation {
  if (status !== 'sent' && status !== 'quoted') {
    return { ok: false, error: 'Only a sent quote request can be closed.' };
  }
  return { ok: true };
}

export function canCancel(status: RfqStatus): Validation {
  if (status !== 'draft' && status !== 'sent') {
    return { ok: false, error: 'This quote request is already settled.' };
  }
  return { ok: true };
}

/** Lines and the vendor set only change while the RFQ is a draft. */
export function canEditDocument(status: RfqStatus): Validation {
  if (status !== 'draft') {
    return { ok: false, error: 'A sent quote request is locked; cancel it to start over.' };
  }
  return { ok: true };
}

// ---------- the RFQ chain (bench status read, OrderTrack shape) ----------

export interface RfqChainStep {
  step: 'DRAFTED' | 'SENT' | 'QUOTED' | 'CLOSED';
  state: 'done' | 'pending' | 'stopped';
}

/**
 * The four-node RFQ chain. Canceled renders the reached nodes then a stopped
 * node at the point the document died — same honest-state language as the PO
 * chain (nothing pretends to progress).
 */
export function buildRfqChain(status: RfqStatus): RfqChainStep[] {
  const order: RfqChainStep['step'][] = ['DRAFTED', 'SENT', 'QUOTED', 'CLOSED'];
  const reached: Record<RfqStatus, number> = {
    draft: 1,
    sent: 2,
    quoted: 3,
    closed: 4,
    canceled: 1,
  };
  const n = reached[status];
  return order.map((step, i) => ({
    step,
    state: status === 'canceled' && i === n ? 'stopped' : i < n ? 'done' : 'pending',
  }));
}

// ---------- per-vendor export document (design §7.2: export-for-manual-send) ----------

export interface RfqExportLine {
  lineNo: number;
  sku: string;
  productName: string;
  qty: number;
  stockUom: string | null;
  note: string | null;
}

export interface RfqExportHeader {
  title: string;
  vendorName: string;
  locationName: string;
  respondBy: string | null; // ISO date
}

function csvCell(value: string | number | null): string {
  if (value == null) {
    return '';
  }
  const s = String(value);
  // Formula-injection guard (same posture as the valuation export): a cell
  // starting with = + - @ gets a leading apostrophe so spreadsheets treat it
  // as text.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

/** One CSV per vendor: a header block vendors can read, then the line table. */
export function rfqToVendorCsv(header: RfqExportHeader, lines: RfqExportLine[]): string {
  const head = [
    ['Request for quote', csvCell(header.title)].join(','),
    ['Vendor', csvCell(header.vendorName)].join(','),
    ['Deliver to', csvCell(header.locationName)].join(','),
    ['Respond by', csvCell(header.respondBy ?? 'at your earliest convenience')].join(','),
    '',
    [
      'line',
      'sku',
      'product',
      'quantity',
      'unit',
      'note',
      'your unit price',
      'your lead time (days)',
    ].join(','),
  ];
  const body = lines.map((l) =>
    [
      csvCell(l.lineNo),
      csvCell(l.sku),
      csvCell(l.productName),
      csvCell(l.qty),
      csvCell(l.stockUom ?? 'each'),
      csvCell(l.note),
      '', // vendors fill these two in
      '',
    ].join(','),
  );
  return [...head, ...body].join('\n');
}

// ---------- error mapping ----------

export function mapRfqWriteError(code: string | undefined, message: string): string {
  if (code === '42501' || /row-level security/i.test(message)) {
    return PERMISSION_MESSAGE;
  }
  if (code === '23505') {
    return 'That line or vendor is already on this quote request.';
  }
  if (code === '23503') {
    return 'That SKU or vendor no longer exists.';
  }
  if (code === '23514') {
    return 'Quantity must be greater than zero.';
  }
  return 'Could not save the quote request. Please try again.';
}
