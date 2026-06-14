/**
 * Alerts queue read model (in-app alerts engine) — server-only. RLS-scoped
 * (`tenant_id = jwt_tenant_id()`), so it never takes a tenant_id. Maps the raw
 * `alerts` row to the flat shape the queue renders: the operator memo + cobalt
 * CTA from the payload, the severity, the age, and the reopen count (how many
 * times this condition has escalated).
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlertKind, AlertSeverity } from './conditions';

export interface AlertView {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  memo: string;
  ctaLabel: string;
  ctaHref: string;
  reopenCount: number;
  createdAt: string;
}

interface RawAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  reopen_count: number;
  created_at: string;
  payload: { memo?: string; ctaLabel?: string; ctaHref?: string } | null;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };

export async function listOpenAlerts(supabase: SupabaseClient): Promise<AlertView[]> {
  const { data, error } = await supabase
    .from('alerts')
    .select('id, kind, severity, reopen_count, created_at, payload')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .returns<RawAlert[]>();
  if (error) throw new Error(`listOpenAlerts failed: ${error.message}`);

  const rows = (data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    memo: a.payload?.memo ?? 'A condition needs your attention.',
    ctaLabel: a.payload?.ctaLabel ?? 'Open',
    ctaHref: a.payload?.ctaHref ?? '/',
    reopenCount: a.reopen_count,
    createdAt: a.created_at,
  }));

  // Most severe first, then newest — the worst things sit at the top of the queue.
  rows.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.createdAt < b.createdAt ? 1 : -1),
  );
  return rows;
}

export function openAlertCounts(rows: AlertView[]): Record<AlertSeverity, number> {
  const counts: Record<AlertSeverity, number> = { critical: 0, warn: 0, info: 0 };
  for (const r of rows) counts[r.severity]++;
  return counts;
}
