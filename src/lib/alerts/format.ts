/**
 * Alert presentation helpers (in-app alerts engine) — pure, CLIENT-SAFE (no
 * `server-only`). The queue is a client component, so the kind label + relative
 * age live here rather than in the server-only `queue.ts` read model.
 */

import type { AlertKind } from './conditions';

/** Short operator-facing kind label for the row chip. */
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  reorder_due: 'Reorder',
  stockout_risk: 'Stockout',
  overstock: 'Overstock',
  po_late: 'Late PO',
  sync_failure: 'Sync',
  sync_conflict: 'Conflict',
};

/** Compact "how long open" for the row, e.g. "now", "3h", "2d". */
export function relativeAge(createdAtIso: string, nowMs: number): string {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return '';
  const mins = Math.max(0, Math.floor((nowMs - created) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
