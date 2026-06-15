/**
 * Shared weekly-digest facts (Block 12 Wave B2). NOT server-only: the insight
 * generator assembles these via the admin client, AND the Flow page renders the
 * same counts as a "This week" strip via the RLS client, so every number the
 * digest narrates is visible on-screen (trust hierarchy). One source of truth =
 * the two can never disagree.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeeklyChangeFacts } from './prompts';

export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The cache-period stamp for `now` (YYYY-MM-DD). */
export function weeklyPeriodKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Start of the trailing 7-day window the counts cover. */
export function weeklyWindowStart(nowMs: number): string {
  return new Date(nowMs - WEEKLY_WINDOW_MS).toISOString();
}

/**
 * Count the week's operational movement: alerts raised + reorder flags + PO
 * receipts inside the trailing window, plus the currently-pending sync conflicts.
 * Exact-count head queries (no rows pulled). A failed count degrades to 0 so the
 * surface never throws — a quiet read is the honest fallback. Works with either
 * the admin client (explicit tenant) or the RLS client (auto-scoped).
 */
export async function assembleWeeklyChangeFacts(
  client: SupabaseClient,
  tenantId: string,
  since: string,
): Promise<WeeklyChangeFacts> {
  const [alertsRaised, reordersFlagged, receiptsLogged, conflictsPending] = await Promise.all([
    countSince(client, 'alerts', tenantId, 'created_at', since),
    countSince(client, 'reorder_recommendations', tenantId, 'created_at', since),
    countSince(client, 'po_receipt_events', tenantId, 'applied_at', since),
    countPendingConflicts(client, tenantId),
  ]);
  return { alertsRaised, reordersFlagged, receiptsLogged, conflictsPending };
}

async function countSince(
  client: SupabaseClient,
  table: string,
  tenantId: string,
  column: string,
  since: string,
): Promise<number> {
  const { count } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte(column, since);
  return count ?? 0;
}

async function countPendingConflicts(client: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await client
    .from('sync_conflicts')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('resolved_at', null);
  return count ?? 0;
}
