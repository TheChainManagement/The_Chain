/**
 * Audit-log transform layer (Block 14a) — pure, no I/O, fully unit-tested.
 *
 * Holds the three rules the viewer and the CSV export both depend on:
 *   1. the role gate (owner / manager / finance read the trail; nobody else),
 *   2. the tier to hot-window mapping (how far back a tenant can see), and
 *   3. the before/after diff the chain expands on click.
 *
 * Keeping these here means the page, the API route, and the tests all run the
 * exact same logic — the gate can't drift between the screen and the export.
 */

/** The five retention tiers, mirroring the `retention_tier` enum. */
export type RetentionTier = 'free' | 'starter' | 'standard' | 'pro' | 'enterprise';

/** Member roles that may read the audit trail (matches the `audit_log` RLS policy). */
export const AUDIT_ROLES = ['owner', 'manager', 'finance'] as const;
export type AuditRole = (typeof AUDIT_ROLES)[number];

/**
 * The single gate. The `audit_log` RLS policy enforces this at the database, but
 * the page and the CSV route call this directly so a denied caller gets an
 * explicit "restricted" surface / 403 instead of a confusing empty result.
 */
export function canReadAudit(role: string | null | undefined): role is AuditRole {
  return role != null && (AUDIT_ROLES as readonly string[]).includes(role);
}

/**
 * Tier to visible window, in days. The hot window is how far back the operator
 * can read before the trail tucks behind an upgrade. `null` = unlimited (no
 * cutoff). Free maps to the 14-day trial length; the rest are the FEATURES.md
 * tiers. The exact spans lock with pricing — changing a number here moves the
 * whole window with zero partition movement (the rows never leave the table).
 */
export const RETENTION_WINDOW_DAYS: Record<RetentionTier, number | null> = {
  free: 14,
  starter: 365,
  standard: 365 * 5,
  pro: 365 * 10,
  enterprise: null,
};

const DAY_MS = 86_400_000;

/**
 * The ISO cutoff for a tier's hot window: rows at/after this are visible, older
 * rows are gated. `null` means unlimited — show everything.
 */
export function tierWindowCutoffIso(tier: RetentionTier, nowMs: number): string | null {
  const days = RETENTION_WINDOW_DAYS[tier];
  if (days === null) return null;
  return new Date(nowMs - days * DAY_MS).toISOString();
}

/** Human label for the window, shown in the header and the upgrade stub. */
export function tierWindowLabel(tier: RetentionTier): string {
  switch (tier) {
    case 'free':
      return 'Trial period';
    case 'starter':
      return '1 year';
    case 'standard':
      return '5 years';
    case 'pro':
      return '10 years';
    case 'enterprise':
      return 'Unlimited';
  }
}

/**
 * Tracked tables to operator-facing labels (singular, plain words). The audit
 * dispatcher fires on far more than the 13 "ROI" tables FEATURES names, so this
 * covers everything seen in real data; anything new falls through to humanize().
 */
export const ENTITY_LABEL: Record<string, string> = {
  products: 'Product',
  purchase_orders: 'Purchase order',
  purchase_order_lines: 'PO line',
  inventory_levels: 'Stock level',
  stock_movements: 'Stock movement',
  suppliers: 'Supplier',
  product_suppliers: 'Product–supplier link',
  subscriptions: 'Subscription',
  tenant_members: 'Team member',
  tenants: 'Workspace',
  source_connections: 'Connection',
  reorder_recommendations: 'Reorder',
  inventory_policy: 'Inventory policy',
  sync_conflicts: 'Sync conflict',
  locations: 'Location',
  sync_runs: 'Sync run',
  sync_failures: 'Sync failure',
  supplier_scorecards: 'Supplier scorecard',
  supplier_performance: 'Delivery record',
  po_receipt_events: 'PO receipt',
  forecasts: 'Forecast',
  forecast_points: 'Forecast point',
  forecast_evaluations: 'Forecast evaluation',
  product_classifications: 'Classification',
  classification_thresholds: 'Classification threshold',
  category_benchmarks: 'Category benchmark',
  onboarding_state: 'Onboarding',
  alerts: 'Alert',
  insights: 'Insight',
};

export function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] ?? humanize(entityType);
}

/**
 * The action string is `<entity>.<op>`. The trigger writes insert/update/delete;
 * the hand-written bootstrap rows use past tense (`tenant.created`) and a few
 * carry a custom verb (`onboarding.seed_only_bypass`) that reads as a generic
 * change. We map the op tail to a verb and fall back to 'Changed'.
 */
export type AuditVerb = 'Created' | 'Updated' | 'Removed' | 'Changed';

export function actionVerb(action: string): AuditVerb {
  const op = action.split('.').pop();
  switch (op) {
    case 'insert':
    case 'created':
    case 'added':
      return 'Created';
    case 'update':
    case 'updated':
      return 'Updated';
    case 'delete':
    case 'deleted':
    case 'removed':
      return 'Removed';
    default:
      return 'Changed';
  }
}

export type DiffKind = 'added' | 'removed' | 'changed';
export interface FieldDiff {
  key: string;
  before: string | null;
  after: string | null;
  kind: DiffKind;
}

/**
 * Fields the diff never displays. The audit trigger already strips secrets from
 * the row before writing (encrypted creds, tokens, password hashes), so this is
 * a second, defensive belt: if a denylisted key ever reaches the jsonb, the
 * viewer still won't render it. Keeps the "no PII beyond the source row" bar.
 */
const REDACTED_KEYS = new Set([
  'password',
  'password_hash',
  'encrypted_password',
  'encrypted_credentials',
  'token',
  'access_token',
  'refresh_token',
  'secret',
]);

type Json = Record<string, unknown> | null | undefined;

/**
 * Compute the field-level diff between the before/after row snapshots.
 *   - insert (before empty): every after field is `added`
 *   - delete (after empty): every before field is `removed`
 *   - update: only the keys whose value actually changed, as `changed`
 * Values are stringified for display; redacted keys are dropped entirely.
 */
export function diffFields(before: Json, after: Json, verb: AuditVerb): FieldDiff[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const out: FieldDiff[] = [];

  for (const key of keys) {
    if (REDACTED_KEYS.has(key)) continue;
    const hasBefore = key in b;
    const hasAfter = key in a;
    const beforeVal = hasBefore ? stringifyValue(b[key]) : null;
    const afterVal = hasAfter ? stringifyValue(a[key]) : null;

    if (verb === 'Created') {
      if (afterVal !== null) out.push({ key, before: null, after: afterVal, kind: 'added' });
      continue;
    }
    if (verb === 'Removed') {
      if (beforeVal !== null) out.push({ key, before: beforeVal, after: null, kind: 'removed' });
      continue;
    }
    // Update / Changed: surface only real changes.
    if (beforeVal !== afterVal) {
      out.push({ key, before: beforeVal, after: afterVal, kind: 'changed' });
    }
  }
  return out;
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function humanize(token: string): string {
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** True when the event happened on the same UTC calendar day as `nowMs`. */
export function isSameUtcDay(iso: string, nowMs: number): boolean {
  return iso.slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);
}

// ---- CSV export -----------------------------------------------------------

export interface AuditCsvRow {
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  changedFields: string;
}

const CSV_HEADER = [
  'occurred_at',
  'action',
  'entity_type',
  'entity_id',
  'actor_user_id',
  'changed_fields',
] as const;

/** Serialize audit rows to RFC-4180 CSV (quoted, CRLF, embedded quotes doubled). */
export function toAuditCsv(rows: AuditCsvRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [r.occurredAt, r.action, r.entityType, r.entityId ?? '', r.actorUserId ?? '', r.changedFields]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// ---- Export period parsing ------------------------------------------------

export interface PeriodRange {
  startIso: string;
  endIso: string;
}

/**
 * Resolve the `[period]` path segment of the export URL to a date range, clamped
 * to the tier hot window so a caller can never export past their cutoff.
 *   - `window` / `all` to the full hot window [cutoff, now]
 *   - `YYYY`           to that calendar year, clamped to the window
 *   - `YYYY-MM`        to that calendar month, clamped to the window
 * Returns null for an unparseable period.
 */
export function resolvePeriod(
  period: string,
  cutoffIso: string | null,
  nowMs: number,
): PeriodRange | null {
  const nowIso = new Date(nowMs).toISOString();
  const floor = cutoffIso ?? '0000-01-01T00:00:00.000Z';

  if (period === 'window' || period === 'all') {
    return { startIso: floor, endIso: nowIso };
  }

  const yearMatch = /^(\d{4})$/.exec(period);
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    return clampRange(`${y}-01-01T00:00:00.000Z`, `${y + 1}-01-01T00:00:00.000Z`, floor, nowIso);
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthMatch) {
    const y = Number(monthMatch[1]);
    const m = Number(monthMatch[2]);
    if (m < 1 || m > 12) return null;
    const start = `${monthMatch[1]}-${monthMatch[2]}-01T00:00:00.000Z`;
    const endMs = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
    return clampRange(start, new Date(endMs).toISOString(), floor, nowIso);
  }

  return null;
}

function clampRange(startIso: string, endIso: string, floor: string, nowIso: string): PeriodRange {
  const start = startIso < floor ? floor : startIso;
  const end = endIso > nowIso ? nowIso : endIso;
  // An entirely-out-of-window request collapses to an empty range (start >= end);
  // the route returns a header-only CSV rather than leaking gated rows.
  return { startIso: start, endIso: end < start ? start : end };
}
