/**
 * Alert conditions (in-app alerts engine) — pure, no I/O. Given the operator's
 * risk surfaces (policies, open reorder recommendations, late POs, sync
 * failures + conflicts) this produces the fireable alerts the generation step
 * upserts through the dedupe contract.
 *
 * The memorable element lives here: every alert carries a one-sentence operator
 * MEMO with the numbers that matter and a single cobalt CTA to the fix — not a
 * vague "stockout risk on SKU 47331." A SKU that already has an open reorder
 * recommendation fires `reorder_due` (the actionable one) and is suppressed from
 * `stockout_risk`/`overstock`, so one SKU never doubles up.
 */

export type AlertKind =
  | 'reorder_due'
  | 'stockout_risk'
  | 'overstock'
  | 'po_late'
  | 'sync_failure'
  | 'sync_conflict';

export type AlertSeverity = 'info' | 'warn' | 'critical';

/** The kinds this engine owns — the auto-close sweep is scoped to these. */
export const ENGINE_KINDS: AlertKind[] = [
  'reorder_due',
  'stockout_risk',
  'overstock',
  'po_late',
  'sync_failure',
  'sync_conflict',
];

export interface AlertPayload {
  /** The operator memo — one sentence, the numbers that matter. */
  memo: string;
  ctaLabel: string;
  ctaHref: string;
  metrics?: Record<string, number | string | null>;
}

export interface FireableAlert {
  kind: AlertKind;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
  severity: AlertSeverity;
  payload: AlertPayload;
}

// ----- inputs (flat read models the generation step assembles) -----

export interface PolicyRow {
  productId: string;
  sku: string;
  name: string;
  daysOfSupply: number | null;
  stockoutRiskScore: number | null;
  reorderPoint: number | null;
}

export interface OpenRecRow {
  productId: string;
  sku: string;
  name: string;
  recommendedQty: number;
  position: number;
  reorderPoint: number;
  safetyStock: number;
  daysOfSupply: number | null;
}

export interface LatePoRow {
  poId: string;
  reference: string;
  supplierName: string;
  daysLate: number;
}

export interface SyncFailureRow {
  id: string;
  entityType: string | null;
  message: string | null;
}

export interface ConditionInputs {
  policies: PolicyRow[];
  openRecs: OpenRecRow[];
  latePos: LatePoRow[];
  syncFailures: SyncFailureRow[];
  syncConflictCount: number;
}

// ----- thresholds (single source) -----

const STOCKOUT_INFO = 0.25;
const STOCKOUT_WARN = 0.4;
const STOCKOUT_CRITICAL = 0.7;
const OVERSTOCK_INFO_DOS = 90;
const OVERSTOCK_WARN_DOS = 180;
const PO_LATE_CRITICAL_DAYS = 7;

export function dedupeKey(
  kind: AlertKind,
  entityType: string | null,
  entityId: string | null,
): string {
  return `${kind}:${entityType ?? ''}:${entityId ?? ''}`;
}

const round = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function reorderAlert(r: OpenRecRow): FireableAlert {
  const severity: AlertSeverity =
    r.position <= 0 ? 'critical' : r.position < r.safetyStock ? 'warn' : 'info';
  const memo =
    `${r.sku} hit its reorder point — ${round(r.position)} on hand against a ` +
    `${round(r.reorderPoint)} trigger. Reorder ${r.recommendedQty} to rebuild cover.`;
  return {
    kind: 'reorder_due',
    entityType: 'product',
    entityId: r.productId,
    dedupeKey: dedupeKey('reorder_due', 'product', r.productId),
    severity,
    payload: {
      memo,
      ctaLabel: 'Review reorder',
      ctaHref: '/reorder',
      metrics: {
        position: round(r.position),
        reorderPoint: round(r.reorderPoint),
        reorderQty: r.recommendedQty,
      },
    },
  };
}

function stockoutAlert(p: PolicyRow): FireableAlert | null {
  const score = p.stockoutRiskScore;
  if (score == null || score < STOCKOUT_INFO) return null;
  const severity: AlertSeverity =
    score >= STOCKOUT_CRITICAL ? 'critical' : score >= STOCKOUT_WARN ? 'warn' : 'info';
  const pct = Math.round(score * 100);
  const window = p.daysOfSupply == null ? '' : ` in ~${round(p.daysOfSupply)} days`;
  return {
    kind: 'stockout_risk',
    entityType: 'product',
    entityId: p.productId,
    dedupeKey: dedupeKey('stockout_risk', 'product', p.productId),
    severity,
    payload: {
      memo: `${p.sku} is trending toward a stockout${window} at the current run rate (${pct}% risk).`,
      ctaLabel: 'See the SKU',
      ctaHref: `/inventory/${p.productId}`,
      metrics: {
        stockoutRiskPct: pct,
        daysOfSupply: p.daysOfSupply == null ? null : round(p.daysOfSupply),
      },
    },
  };
}

function overstockAlert(p: PolicyRow): FireableAlert | null {
  const dos = p.daysOfSupply;
  if (dos == null || dos < OVERSTOCK_INFO_DOS) return null;
  const severity: AlertSeverity = dos >= OVERSTOCK_WARN_DOS ? 'warn' : 'info';
  return {
    kind: 'overstock',
    entityType: 'product',
    entityId: p.productId,
    dedupeKey: dedupeKey('overstock', 'product', p.productId),
    severity,
    payload: {
      memo: `${p.sku} is holding ~${round(dos)} days of supply — capital parked in excess stock.`,
      ctaLabel: 'See the SKU',
      ctaHref: `/inventory/${p.productId}`,
      metrics: { daysOfSupply: round(dos) },
    },
  };
}

function poLateAlert(po: LatePoRow): FireableAlert {
  const severity: AlertSeverity = po.daysLate >= PO_LATE_CRITICAL_DAYS ? 'critical' : 'warn';
  return {
    kind: 'po_late',
    entityType: 'purchase_order',
    entityId: po.poId,
    dedupeKey: dedupeKey('po_late', 'purchase_order', po.poId),
    severity,
    payload: {
      memo:
        `${po.reference} from ${po.supplierName} is ${plural(po.daysLate, 'day')} past its ` +
        `promised date. Chase the delivery.`,
      ctaLabel: 'Open the order',
      ctaHref: `/purchase-orders/${po.poId}`,
      metrics: { daysLate: po.daysLate },
    },
  };
}

function syncFailureAlert(f: SyncFailureRow): FireableAlert {
  const on = f.entityType ? ` on ${f.entityType}` : '';
  const detail = f.message ? ` ${f.message}` : '';
  return {
    kind: 'sync_failure',
    entityType: 'sync_failure',
    entityId: f.id,
    dedupeKey: dedupeKey('sync_failure', 'sync_failure', f.id),
    severity: 'warn',
    payload: {
      memo: `A QuickBooks sync step failed${on}.${detail}`.trim(),
      ctaLabel: 'Check the connection',
      ctaHref: '/integrations/quickbooks',
    },
  };
}

function syncConflictAlert(count: number): FireableAlert {
  return {
    kind: 'sync_conflict',
    entityType: null,
    entityId: null,
    dedupeKey: dedupeKey('sync_conflict', null, null),
    severity: 'warn',
    payload: {
      memo: `${plural(count, 'record')} need review — QuickBooks and an in-app edit changed the same field.`,
      ctaLabel: 'Resolve conflicts',
      ctaHref: '/flow/sync-conflicts',
      metrics: { conflicts: count },
    },
  };
}

/**
 * Build the full set of fireable alerts. A SKU with an open reorder
 * recommendation is owned by `reorder_due` and excluded from `stockout_risk` /
 * `overstock`, so the operator sees one alert per SKU, not three.
 */
export function buildFireableAlerts(input: ConditionInputs): FireableAlert[] {
  const out: FireableAlert[] = [];
  const reorderProductIds = new Set(input.openRecs.map((r) => r.productId));

  for (const r of input.openRecs) out.push(reorderAlert(r));

  for (const p of input.policies) {
    if (reorderProductIds.has(p.productId)) continue; // reorder_due owns this SKU
    const stockout = stockoutAlert(p);
    if (stockout) {
      out.push(stockout);
      continue; // a SKU at stockout risk isn't also "overstocked"
    }
    const over = overstockAlert(p);
    if (over) out.push(over);
  }

  for (const po of input.latePos) out.push(poLateAlert(po));
  for (const f of input.syncFailures) out.push(syncFailureAlert(f));
  if (input.syncConflictCount > 0) out.push(syncConflictAlert(input.syncConflictCount));

  return out;
}
