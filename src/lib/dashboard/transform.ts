/**
 * Dashboard (Block 15 `/today`) — pure selection + bucketing logic over the
 * read models the page already loads (POs, reorder groups, alerts). No I/O here
 * so every reading the operator sees is unit-tested. RLS scoping lives in the
 * read models; this module only shapes what's already tenant-fenced.
 */

import type { AlertView } from '@/lib/alerts/queue';
import { fmtDate, isOpenPo, type PurchaseOrderListRow } from '@/lib/purchase-orders/transform';
import type { ReorderGroup } from '@/lib/reorder/queue';

/** A PO is "in flight" if it's open and has a real expected/actual timeline to
 *  read as a chain. `pending` (no supplier yet) drafts are excluded — the
 *  centerpiece is about an order moving, not a recommendation. */
export function pickMostPressingOpenPo(rows: PurchaseOrderListRow[]): PurchaseOrderListRow | null {
  const open = rows.filter((r) => isOpenPo(r.status));
  if (open.length === 0) return null;
  // Soonest expected delivery is the most pressing; nulls sink to the bottom.
  // Tie-break on the most recently touched order for determinism.
  const sorted = [...open].sort((a, b) => {
    const ea = a.expectedDeliveryAt;
    const eb = b.expectedDeliveryAt;
    if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  });
  return sorted[0] ?? null;
}

/** SKUs sitting at stockout urgency across the whole reorder queue. */
export function stockoutCount(groups: ReorderGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.filter((r) => r.urgency === 'stockout').length, 0);
}

export interface WorstDos {
  dos: number;
  sku: string;
  productId: string;
  locationId: string;
}

/** The single SKU closest to running dry — the lowest days-of-supply across the
 *  reorder queue. Rows without a DOS (no forecast yet) are skipped, never
 *  defaulted to zero. */
export function worstDaysOfSupply(groups: ReorderGroup[]): WorstDos | null {
  let worst: WorstDos | null = null;
  for (const g of groups) {
    for (const r of g.rows) {
      const dos = r.reason.daysOfSupply;
      if (dos === null || dos === undefined) continue;
      if (worst === null || dos < worst.dos) {
        worst = { dos, sku: r.sku, productId: r.productId, locationId: r.locationId };
      }
    }
  }
  return worst;
}

export interface MostUsedSupplier {
  supplierId: string;
  supplierName: string;
  otifPct: number | null;
  poCount: number;
}

/** The most-used supplier — the one on the most purchase orders (the contract's
 *  "most-used supplier", by order volume). OTIF comes from the rolling-30d
 *  scorecard map. Ties break by name for determinism. */
export function mostUsedSupplier(
  rows: PurchaseOrderListRow[],
  otifBySupplier: Map<string, number | null>,
): MostUsedSupplier | null {
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    const prev = counts.get(r.supplierId);
    counts.set(r.supplierId, { name: r.supplierName, n: (prev?.n ?? 0) + 1 });
  }
  let topId: string | null = null;
  let top: { name: string; n: number } | null = null;
  for (const [id, c] of counts) {
    if (top === null || c.n > top.n || (c.n === top.n && c.name < top.name)) {
      topId = id;
      top = c;
    }
  }
  if (topId === null || top === null) return null;
  return {
    supplierId: topId,
    supplierName: top.name,
    otifPct: otifBySupplier.get(topId) ?? null,
    poCount: top.n,
  };
}

export interface DayBucket {
  /** UTC midnight ISO for the day. */
  dayIso: string;
  /** Short label, e.g. "May 28". */
  label: string;
  /** POs received/closed that landed on this day. */
  count: number;
  isToday: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Last 7 UTC days (oldest → today), each bucketing PO completions by their
 *  actual delivery date. The throughput ruler reads off this. */
export function throughputLast7Days(rows: PurchaseOrderListRow[], nowMs: number): DayBucket[] {
  const todayStart = utcDayStart(nowMs);
  const buckets: DayBucket[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const dayStart = todayStart - i * DAY_MS;
    buckets.push({
      dayIso: new Date(dayStart).toISOString(),
      label: fmtDate(new Date(dayStart).toISOString()),
      count: 0,
      isToday: i === 0,
    });
  }
  const windowStart = todayStart - 6 * DAY_MS;
  for (const r of rows) {
    if (r.status !== 'received' && r.status !== 'closed') continue;
    if (!r.actualDeliveryAt) continue;
    const t = new Date(r.actualDeliveryAt).getTime();
    if (Number.isNaN(t)) continue;
    const day = utcDayStart(t);
    if (day < windowStart || day > todayStart) continue;
    const idx = Math.round((day - windowStart) / DAY_MS);
    const bucket = buckets[idx];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export type DashboardStage = 'fresh' | 'onboarding' | 'populated';

/** Which of the three required render stages the tenant is in:
 *  - `fresh`: nothing yet (no catalog, no orders/recs/alerts) → connect a source.
 *  - `onboarding`: catalog imported but the engine hasn't produced an actionable
 *    surface yet (no orders, no recommendations) → "your workshop is forming".
 *  - `populated`: there's an order or a recommendation to act on. */
export function dashboardStage(
  hasCatalog: boolean,
  rows: PurchaseOrderListRow[],
  groups: ReorderGroup[],
  alerts: AlertView[],
): DashboardStage {
  const hasActionable = rows.length > 0 || groups.length > 0;
  if (hasActionable) return 'populated';
  if (hasCatalog || alerts.length > 0) return 'onboarding';
  return 'fresh';
}
