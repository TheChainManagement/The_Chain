/**
 * Pure supplier transforms (Block 4) — no IO, no `server-only`, unit-testable.
 *
 * Mirrors lib/inventory/transform.ts: queries.ts fetches RLS-scoped rows and maps
 * them here; actions.ts uses the validation + write-error mapping. OTIF tone, the
 * reliability-ribbon tile derivation, and lead-time formatting all live here so
 * they are covered by fast tests instead of round-tripping Postgres.
 */

import type { StatTone } from '@/components/StatNumber/StatNumber';

export type SupplierStatus = 'active' | 'archived';

export interface SupplierContact {
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface SupplierListRow {
  id: string;
  name: string;
  status: SupplierStatus;
  defaultLeadTimeDays: number | null;
  minOrderValue: number | null;
  productCount: number;
  otifPct: number | null;
}

export type ReliabilityState = 'otif' | 'short' | 'late' | 'pending';

export interface ReliabilityTile {
  state: ReliabilityState;
  poRef: string | null;
  when: string | null;
}

export interface LinkedProduct {
  productId: string;
  sku: string | null;
  name: string | null;
  unitCost: number | null;
  leadTimeDays: number | null;
  moq: number | null;
  isPrimary: boolean;
}

export interface SupplierDetail {
  id: string;
  name: string;
  status: SupplierStatus;
  contact: SupplierContact;
  defaultLeadTimeDays: number | null;
  minOrderValue: number | null;
  qboVendorId: string | null;
  createdAt: string;
  updatedAt: string;
  products: LinkedProduct[];
  reliability: ReliabilityTile[];
  otifPct: number | null;
  onTimePct: number | null;
  inFullPct: number | null;
  leadTimeAvgDays: number | null;
  leadTimeStddevDays: number | null;
  scorecardSampleSize: number;
}

export const RELIABILITY_TILES = 8;

const numOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * OTIF semantic tone. Tabular OTIF is never cobalt (cobalt is brand intent, not
 * data): on-target reads flow-green, slipping reads warn-amber, poor reads
 * stop-red. Thresholds: >= 95% on-target, >= 85% watch, else critical.
 */
export function otifTone(pct: number | null): StatTone {
  if (pct == null) {
    return 'deep';
  }
  if (pct >= 0.95) {
    return 'flow';
  }
  if (pct >= 0.85) {
    return 'warn';
  }
  return 'stop';
}

/** OTIF stored as a 0..1 fraction; render as a percentage value. */
export function otifPercent(pct: number | null): number | null {
  return pct == null ? null : Math.round(pct * 1000) / 10;
}

interface RawPerformance {
  on_time: boolean | null;
  in_full: boolean | null;
  on_time_in_full: boolean | null;
  actual_delivery_at: string | null;
  recorded_at: string | null;
  po_id: string | null;
}

/** Classify one delivery into a ribbon tile state. */
export function tileState(p: {
  on_time: boolean | null;
  in_full: boolean | null;
  on_time_in_full: boolean | null;
}): ReliabilityState {
  if (p.on_time_in_full) {
    return 'otif';
  }
  // Delivered but short (not in full) reads amber; delivered late reads red.
  if (p.in_full === false) {
    return 'short';
  }
  if (p.on_time === false) {
    return 'late';
  }
  return 'otif';
}

/**
 * Build the fixed-width reliability ribbon from the most recent deliveries.
 * Always returns RELIABILITY_TILES tiles, newest first, padded with 'pending'
 * placeholders so the ribbon's shape is visible before any PO history exists.
 */
export function buildReliabilityRibbon(
  perf: RawPerformance[] | null | undefined,
): ReliabilityTile[] {
  const rows = (perf ?? []).slice(0, RELIABILITY_TILES);
  const tiles: ReliabilityTile[] = rows.map((p) => ({
    state: tileState(p),
    poRef: p.po_id,
    when: p.actual_delivery_at ?? p.recorded_at,
  }));
  while (tiles.length < RELIABILITY_TILES) {
    tiles.push({ state: 'pending', poRef: null, when: null });
  }
  return tiles;
}

/* ----- raw row shapes ----- */

interface RawScorecard {
  window_kind: string;
  otif_pct: number | string | null;
  on_time_pct: number | string | null;
  in_full_pct: number | string | null;
  lead_time_avg_days: number | string | null;
  lead_time_stddev_days: number | string | null;
  sample_size: number | null;
}

export interface RawSupplierListRow {
  id: string;
  name: string;
  status: SupplierStatus;
  default_lead_time_days: number | null;
  min_order_value: number | string | null;
  product_suppliers: { count: number }[] | null;
  supplier_scorecards: RawScorecard[] | null;
}

export interface RawSupplierLink {
  product_id: string;
  unit_cost: number | string | null;
  lead_time_days: number | null;
  moq: number | null;
  is_primary: boolean;
  products: { sku: string | null; name: string | null } | null;
}

export interface RawSupplierDetail {
  id: string;
  name: string;
  status: SupplierStatus;
  contact: SupplierContact | null;
  default_lead_time_days: number | null;
  min_order_value: number | string | null;
  qbo_vendor_id: string | null;
  created_at: string;
  updated_at: string;
  product_suppliers: RawSupplierLink[] | null;
  supplier_performance: RawPerformance[] | null;
  supplier_scorecards: RawScorecard[] | null;
}

/** Rolling-30d scorecard is the headline window; fall back to any. */
function pickScorecard(rows: RawScorecard[] | null | undefined): RawScorecard | null {
  const list = rows ?? [];
  return list.find((r) => r.window_kind === 'rolling_30d') ?? list[0] ?? null;
}

export function mapSupplierListRow(s: RawSupplierListRow): SupplierListRow {
  const card = pickScorecard(s.supplier_scorecards);
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    defaultLeadTimeDays: s.default_lead_time_days,
    minOrderValue: numOrNull(s.min_order_value),
    productCount: s.product_suppliers?.[0]?.count ?? 0,
    otifPct: card ? numOrNull(card.otif_pct) : null,
  };
}

export function mapSupplierDetail(s: RawSupplierDetail): SupplierDetail {
  const card = pickScorecard(s.supplier_scorecards);
  const products: LinkedProduct[] = (s.product_suppliers ?? [])
    .map((l) => ({
      productId: l.product_id,
      sku: l.products?.sku ?? null,
      name: l.products?.name ?? null,
      unitCost: numOrNull(l.unit_cost),
      leadTimeDays: l.lead_time_days,
      moq: l.moq,
      isPrimary: l.is_primary,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  return {
    id: s.id,
    name: s.name,
    status: s.status,
    contact: s.contact ?? {},
    defaultLeadTimeDays: s.default_lead_time_days,
    minOrderValue: numOrNull(s.min_order_value),
    qboVendorId: s.qbo_vendor_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    products,
    reliability: buildReliabilityRibbon(s.supplier_performance),
    otifPct: card ? numOrNull(card.otif_pct) : null,
    onTimePct: card ? numOrNull(card.on_time_pct) : null,
    inFullPct: card ? numOrNull(card.in_full_pct) : null,
    leadTimeAvgDays: card ? numOrNull(card.lead_time_avg_days) : null,
    leadTimeStddevDays: card ? numOrNull(card.lead_time_stddev_days) : null,
    scorecardSampleSize: card?.sample_size ?? 0,
  };
}

/* ----- validation + write-error mapping ----- */

export interface SupplierInput {
  name?: string;
  defaultLeadTimeDays?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateSupplierInput(input: SupplierInput): ValidationResult {
  if (!input.name?.trim()) {
    return { ok: false, error: 'Supplier name is required.' };
  }
  if (input.defaultLeadTimeDays?.trim()) {
    const n = Number(input.defaultLeadTimeDays);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { ok: false, error: 'Lead time must be a whole number of days.' };
    }
  }
  return { ok: true };
}

export interface LinkInput {
  supplierId?: string;
  unitCost?: string;
  leadTimeDays?: string;
  moq?: string;
  purchaseUom?: string;
  purchaseToStockFactor?: string;
}

/** Parsed-number check: 'blank' | 'bad' | a finite number. */
function checkNumber(raw: string | undefined): 'blank' | 'bad' | number {
  if (!raw?.trim()) {
    return 'blank';
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 'bad';
}

export function validateLinkInput(input: LinkInput): ValidationResult {
  if (!input.supplierId?.trim()) {
    return { ok: false, error: 'Pick a supplier to link.' };
  }

  const cost = checkNumber(input.unitCost);
  if (cost === 'bad') {
    return { ok: false, error: 'Unit cost must be a number.' };
  }
  if (typeof cost === 'number' && cost < 0) {
    return { ok: false, error: 'Unit cost cannot be negative.' };
  }

  for (const [label, raw] of [
    ['Lead time', input.leadTimeDays],
    ['MOQ', input.moq],
  ] as const) {
    const n = checkNumber(raw);
    if (n === 'bad' || (typeof n === 'number' && (!Number.isInteger(n) || n < 0))) {
      return { ok: false, error: `${label} must be a whole number of 0 or more.` };
    }
  }

  // Purchase-unit conversion (W2-2.5): 1 purchase unit = factor stock units.
  // The factor is a ratio, so fractions are fine; zero and below are not.
  const factor = checkNumber(input.purchaseToStockFactor);
  if (factor === 'bad' || (typeof factor === 'number' && factor <= 0)) {
    return { ok: false, error: 'Units per purchase unit must be a number greater than 0.' };
  }
  const hasUom = Boolean(input.purchaseUom?.trim());
  const hasFactor = typeof factor === 'number';
  if (hasUom !== hasFactor) {
    return {
      ok: false,
      error: 'Set both the purchase unit and its conversion factor, or neither.',
    };
  }
  return { ok: true };
}

/**
 * Render a purchase-to-stock factor without trailing zeros (numeric(14,4) rows
 * arrive as "12.0000"; the operator should read "12", and "0.5" stays "0.5").
 */
export function formatPurchaseFactor(factor: number): string {
  return String(Number(factor.toFixed(4)));
}

export const PERMISSION_MESSAGE =
  'You do not have permission to change suppliers. Ask an owner or manager.';

export function mapSupplierWriteError(code: string | undefined, message: string): string {
  if (code === '23505') {
    return 'That supplier is already linked to this product.';
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return PERMISSION_MESSAGE;
  }
  return 'Could not save. Please try again.';
}

/** PO statuses that count as "open" (block supplier archive). */
export const OPEN_PO_STATUSES = [
  'draft',
  'recommended',
  'approved',
  'exported',
  'sent',
  'partial_received',
] as const;

export function formatOpenPoError(refs: string[]): string {
  const list = refs.slice(0, 5).join(', ');
  const more = refs.length > 5 ? ` and ${refs.length - 5} more` : '';
  return `Cannot archive: this supplier has open purchase orders (${list}${more}). Close or cancel them first.`;
}
