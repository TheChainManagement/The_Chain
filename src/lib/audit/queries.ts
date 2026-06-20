/**
 * Audit-log read model (Block 14a) — server-only.
 *
 * The event list is RLS-scoped (the `audit_log` policy already fences it to
 * owner/manager/finance within the tenant). The retention tier is read with the
 * admin client instead: the `subscriptions` SELECT policy is owner/finance only,
 * so a *manager* viewing the audit log couldn't read their own tier through RLS.
 * The page is already role-gated to owner/manager/finance and the tier is not
 * sensitive, so we resolve it with an explicit tenant filter on the admin client.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  type AuditCsvRow,
  type AuditVerb,
  actionVerb,
  diffFields,
  entityLabel,
  type FieldDiff,
  isSameUtcDay,
  type RetentionTier,
} from './transform';

export interface AuditEventView {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  verb: AuditVerb;
  /** Who acted: 'You', 'System' (trigger/no actor), or 'Teammate'. No PII. */
  actor: 'You' | 'System' | 'Teammate';
  actorUserId: string | null;
  isToday: boolean;
  fields: FieldDiff[];
}

interface RawAuditRow {
  id: number;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** The viewer shows the most recent N within the window; the rest live in the CSV. */
export const AUDIT_PAGE_LIMIT = 200;

export interface ListAuditResult {
  events: AuditEventView[];
  /** True when the window holds more than this page — the UI says so honestly. */
  capped: boolean;
}

export interface ListAuditOptions {
  cutoffIso: string | null;
  entityType?: string;
  currentUserId: string | null;
  nowMs: number;
  limit?: number;
}

/**
 * Most-recent audit events within the tier hot window, newest first. RLS scopes
 * to the tenant; the cutoff and the optional entity filter are applied in SQL.
 * The list is capped at one page (`AUDIT_PAGE_LIMIT`); when more rows exist in
 * the window, `capped` is true so the UI can say "showing the most recent N" and
 * point at the CSV rather than silently dropping in-window history. (Query is
 * indexed on `occurred_at`; the p95 bench is a separate seeded-Preview ticket.)
 */
export async function listAuditEvents(
  supabase: SupabaseClient,
  opts: ListAuditOptions,
): Promise<ListAuditResult> {
  const limit = opts.limit ?? AUDIT_PAGE_LIMIT;
  let query = supabase
    .from('audit_log')
    .select('id, occurred_at, action, entity_type, entity_id, actor_user_id, before, after')
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    // Pull one extra row to detect "there's more" without a second count query.
    .limit(limit + 1);

  if (opts.cutoffIso) query = query.gte('occurred_at', opts.cutoffIso);
  if (opts.entityType) query = query.eq('entity_type', opts.entityType);

  const { data, error } = await query.returns<RawAuditRow[]>();
  if (error) throw new Error(`listAuditEvents failed: ${error.message}`);

  const rows = data ?? [];
  const capped = rows.length > limit;
  const events = rows
    .slice(0, limit)
    .map((row) => toEventView(row, opts.currentUserId, opts.nowMs));
  return { events, capped };
}

function toEventView(
  row: RawAuditRow,
  currentUserId: string | null,
  nowMs: number,
): AuditEventView {
  const verb = actionVerb(row.action);
  return {
    id: String(row.id),
    occurredAt: row.occurred_at,
    action: row.action,
    entityType: row.entity_type,
    entityLabel: entityLabel(row.entity_type),
    entityId: row.entity_id,
    verb,
    actor: resolveActor(row.actor_user_id, currentUserId),
    actorUserId: row.actor_user_id,
    isToday: isSameUtcDay(row.occurred_at, nowMs),
    fields: diffFields(row.before, row.after, verb),
  };
}

/**
 * Pull EVERY audit row in a date range for the CSV export — paginated so the
 * download is the whole window, not a silently-truncated first page. Capped at a
 * documented safety ceiling far above any realistic window; `truncated` reports
 * if it's hit so the caller never claims completeness it didn't deliver.
 */
const EXPORT_PAGE = 1000;
const EXPORT_HARD_CAP = 100_000;

export async function collectAuditCsvRows(
  supabase: SupabaseClient,
  range: { startIso: string; endIso: string },
): Promise<{ rows: AuditCsvRow[]; truncated: boolean }> {
  const rows: AuditCsvRow[] = [];
  for (let offset = 0; offset < EXPORT_HARD_CAP; offset += EXPORT_PAGE) {
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, occurred_at, action, entity_type, entity_id, actor_user_id, before, after')
      .gte('occurred_at', range.startIso)
      .lt('occurred_at', range.endIso)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + EXPORT_PAGE - 1)
      .returns<RawAuditRow[]>();
    if (error) throw new Error(`collectAuditCsvRows failed: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      rows.push({
        occurredAt: row.occurred_at,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actorUserId: row.actor_user_id,
        changedFields: diffFields(row.before, row.after, actionVerb(row.action))
          .map((f) => f.key)
          .join(' '),
      });
    }
    if (page.length < EXPORT_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Whether any events exist *older* than the hot-window cutoff — drives the
 * "upgrade to see further back" stub. A `head` count keeps it cheap. Scoped to
 * the active entity filter so a filtered view never claims gated history that
 * belongs to a different record type. Unlimited tiers (null cutoff) have none.
 */
export async function hasOlderHistory(
  supabase: SupabaseClient,
  cutoffIso: string | null,
  entityType?: string,
): Promise<boolean> {
  if (!cutoffIso) return false;
  let query = supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .lt('occurred_at', cutoffIso);
  if (entityType) query = query.eq('entity_type', entityType);
  const { count, error } = await query;
  if (error) throw new Error(`hasOlderHistory failed: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Distinct entity types present in the trail, for the filter control. */
export async function listAuditEntityTypes(
  supabase: SupabaseClient,
  cutoffIso: string | null,
): Promise<string[]> {
  let query = supabase.from('audit_log').select('entity_type').limit(2000);
  if (cutoffIso) query = query.gte('occurred_at', cutoffIso);
  const { data, error } = await query.returns<{ entity_type: string }[]>();
  if (error) throw new Error(`listAuditEntityTypes failed: ${error.message}`);
  return Array.from(new Set((data ?? []).map((r) => r.entity_type))).sort();
}

/**
 * The tenant's retention tier. Read via the admin client (see file header) with
 * an explicit tenant filter. Defaults to 'free' (the tightest window) if the row
 * is missing, so a read miss never widens visibility.
 */
export async function getRetentionTier(tenantId: string): Promise<RetentionTier> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('subscriptions')
    .select('retention_tier')
    .eq('tenant_id', tenantId)
    .maybeSingle<{ retention_tier: RetentionTier }>();
  if (error) throw new Error(`getRetentionTier failed: ${error.message}`);
  return data?.retention_tier ?? 'free';
}

function resolveActor(
  actorUserId: string | null,
  currentUserId: string | null,
): AuditEventView['actor'] {
  if (!actorUserId) return 'System';
  if (currentUserId && actorUserId === currentUserId) return 'You';
  return 'Teammate';
}
