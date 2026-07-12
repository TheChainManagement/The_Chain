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

// ============================================================
// Slice 3 — quote entry, the comparison grid, award (design §7.3)
// ============================================================

/** Quote entry is open while vendors can still answer: sent or quoted. */
export function canEnterQuotes(status: RfqStatus): Validation {
  if (status !== 'sent' && status !== 'quoted') {
    return { ok: false, error: 'Send the request before entering vendor quotes.' };
  }
  return { ok: true };
}

export interface QuoteInput {
  cost: string;
  purchaseUom: string;
  factor: string;
  leadTimeDays: string;
  moq: string;
}

export interface ParsedQuote {
  cost: number;
  purchaseUom: string | null;
  factor: number | null;
  leadTimeDays: number | null;
  moq: number | null;
}

/**
 * Validate one vendor quote as entered. Cost is per PURCHASE unit; the factor
 * converts to stock units (null = same unit). Fractional factors are allowed
 * (MG 2026-07-09); lead time and MOQ are optional non-negative integers.
 */
export function validateQuoteInput(
  input: QuoteInput,
): { ok: true; quote: ParsedQuote } | { ok: false; error: string } {
  const cost = Number(input.cost.trim());
  if (!input.cost.trim() || !Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: 'Enter the quoted unit price (0 or more).' };
  }
  const purchaseUom = input.purchaseUom.trim() || null;
  let factor: number | null = null;
  if (input.factor.trim()) {
    factor = Number(input.factor.trim());
    if (!Number.isFinite(factor) || factor <= 0) {
      return { ok: false, error: 'The conversion factor must be greater than zero.' };
    }
  }
  if (purchaseUom && factor == null) {
    return {
      ok: false,
      error: 'A purchase unit needs its conversion factor (1 unit = ? stock units).',
    };
  }
  let leadTimeDays: number | null = null;
  if (input.leadTimeDays.trim()) {
    leadTimeDays = Number(input.leadTimeDays.trim());
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0) {
      return { ok: false, error: 'Lead time is whole days, 0 or more.' };
    }
  }
  let moq: number | null = null;
  if (input.moq.trim()) {
    moq = Number(input.moq.trim());
    if (!Number.isInteger(moq) || moq < 0) {
      return { ok: false, error: 'MOQ is a whole number, 0 or more.' };
    }
  }
  return { ok: true, quote: { cost, purchaseUom, factor, leadTimeDays, moq } };
}

/** Cost per STOCK unit — the comparable number (quoted cost ÷ factor). */
export function perStockUnitCost(cost: number, factor: number | null): number {
  return cost / (factor ?? 1);
}

export interface VendorQuoteCell {
  supplierId: string;
  quotedUnitCost: number;
  purchaseUom: string | null;
  factor: number | null;
  leadTimeDays: number | null;
  moq: number | null;
  perStockUnit: number;
  cheapest: boolean;
}

/**
 * One comparison row per RFQ line: each vendor's answer normalized to
 * per-stock-unit cost, with the cheapest answered cell flagged (the ignite).
 * Ties: every cell at the minimum lights — the operator breaks the tie.
 */
export function buildQuoteRow(
  quotes: {
    supplierId: string;
    quotedUnitCost: number;
    purchaseUom: string | null;
    factor: number | null;
    leadTimeDays: number | null;
    moq: number | null;
  }[],
): VendorQuoteCell[] {
  const cells = quotes.map((q) => ({
    supplierId: q.supplierId,
    quotedUnitCost: q.quotedUnitCost,
    purchaseUom: q.purchaseUom,
    factor: q.factor,
    leadTimeDays: q.leadTimeDays,
    moq: q.moq,
    perStockUnit: perStockUnitCost(q.quotedUnitCost, q.factor),
    cheapest: false,
  }));
  if (cells.length === 0) {
    return cells;
  }
  const min = Math.min(...cells.map((c) => c.perStockUnit));
  for (const c of cells) {
    c.cheapest = c.perStockUnit === min;
  }
  return cells;
}

export interface AwardPick {
  lineNo: number;
  supplierId: string;
}

export interface AwardLineDraft {
  lineNo: number;
  productId: string;
  supplierId: string;
  /** PURCHASE UoM (the vendor's unit): RFQ stock qty ÷ factor. Fractional allowed. */
  qty: number;
  unitCost: number;
  purchaseUom: string | null;
  factor: number | null;
  sourceQuoteLineNo: number;
}

/**
 * Assemble the requisition draft from the picks. Each picked line converts the
 * RFQ's stock quantity into the winning vendor's purchase unit (÷ factor,
 * fractional allowed per MG) and carries the quote's cost + UoM snapshots —
 * the same purchase-UoM basis PO lines use, so slice 4's conversion is a
 * straight copy. Total = Σ qty × unit cost (purchase basis).
 */
export function computeAward(
  lines: { lineNo: number; productId: string; qty: number }[],
  quotesByLine: Map<number, VendorQuoteCell[]>,
  picks: AwardPick[],
): { ok: true; lines: AwardLineDraft[]; total: number } | { ok: false; error: string } {
  if (picks.length === 0) {
    return { ok: false, error: 'Pick a winning quote for at least one line.' };
  }
  const drafts: AwardLineDraft[] = [];
  let total = 0;
  for (const [i, pick] of picks.entries()) {
    const line = lines.find((l) => l.lineNo === pick.lineNo);
    if (!line) {
      return { ok: false, error: `Line ${pick.lineNo} is no longer on the request.` };
    }
    const cell = quotesByLine.get(pick.lineNo)?.find((c) => c.supplierId === pick.supplierId);
    if (!cell) {
      return { ok: false, error: `That vendor has not quoted line ${pick.lineNo}.` };
    }
    const qty = line.qty / (cell.factor ?? 1);
    drafts.push({
      lineNo: i + 1,
      productId: line.productId,
      supplierId: pick.supplierId,
      qty,
      unitCost: cell.quotedUnitCost,
      purchaseUom: cell.purchaseUom,
      factor: cell.factor,
      sourceQuoteLineNo: pick.lineNo,
    });
    total += qty * cell.quotedUnitCost;
  }
  return { ok: true, lines: drafts, total: Math.round(total * 100) / 100 };
}

// ============================================================
// Slice 4 — requisition lifecycle (design §5, §7.1)
// ============================================================

export type RequisitionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'converted'
  | 'canceled';

/** Roles that may APPROVE or REJECT (single-step, MG 2026-07-12). */
export const REQUISITION_APPROVER_ROLES: ReadonlySet<string> = new Set(['owner', 'manager']);

/** Draft submits; a rejected document resubmits (same document, new audit row). */
export function canSubmitRequisition(status: RequisitionStatus): Validation {
  if (status !== 'draft' && status !== 'rejected') {
    return { ok: false, error: 'This requisition has already been submitted.' };
  }
  return { ok: true };
}

/**
 * Single-step approval: owner or manager, and NEVER the requester approving
 * their own submission (design §7.1). The same guard gates reject — a decision
 * is a decision.
 */
export function canDecideRequisition(input: {
  status: RequisitionStatus;
  role: string;
  actorUserId: string | null;
  requestedByUserId: string | null;
}): Validation {
  if (input.status !== 'submitted') {
    return { ok: false, error: 'Only a submitted requisition can be decided.' };
  }
  if (!REQUISITION_APPROVER_ROLES.has(input.role)) {
    return { ok: false, error: 'Only an owner or manager can decide a requisition.' };
  }
  if (
    input.actorUserId != null &&
    input.requestedByUserId != null &&
    input.actorUserId === input.requestedByUserId
  ) {
    return { ok: false, error: 'You cannot approve your own requisition.' };
  }
  return { ok: true };
}

export function canConvertRequisition(status: RequisitionStatus): Validation {
  if (status === 'converted') {
    return { ok: false, error: 'This requisition has already become its purchase orders.' };
  }
  if (status !== 'approved') {
    return { ok: false, error: 'Approve the requisition before converting it.' };
  }
  return { ok: true };
}

export function canCancelRequisition(status: RequisitionStatus): Validation {
  if (status !== 'draft' && status !== 'submitted' && status !== 'rejected') {
    return { ok: false, error: 'This requisition is already settled.' };
  }
  return { ok: true };
}

export interface RequisitionChainStep {
  step: 'DRAFTED' | 'SUBMITTED' | 'APPROVED' | 'ORDERED';
  state: 'done' | 'pending' | 'stopped';
}

/**
 * The requisition chain: DRAFTED · SUBMITTED · APPROVED · ORDERED. A rejection
 * shows a stop node at APPROVED (the decision point); canceled stops where the
 * document died — same honest-state language as the RFQ and PO chains.
 */
export function buildRequisitionChain(status: RequisitionStatus): RequisitionChainStep[] {
  const order: RequisitionChainStep['step'][] = ['DRAFTED', 'SUBMITTED', 'APPROVED', 'ORDERED'];
  const reached: Record<RequisitionStatus, number> = {
    draft: 1,
    submitted: 2,
    approved: 3,
    rejected: 2,
    converted: 4,
    canceled: 1,
  };
  const stopAt: Partial<Record<RequisitionStatus, number>> = {
    rejected: 2,
    canceled: 1,
  };
  const n = reached[status];
  const stop = stopAt[status];
  return order.map((step, i) => ({
    step,
    state: stop != null && i === stop ? 'stopped' : i < n ? 'done' : 'pending',
  }));
}
