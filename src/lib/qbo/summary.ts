/**
 * Drain a QboSourceAdapter read-only and tally the canonical counts the connect
 * screen forms its chain from. Shared by the sandbox preview and the live sync so
 * both render the exact same shape from the exact same code path.
 */

import type { CanonicalPayload, Cursor, EntityKind, PullResult } from '@/lib/source-adapter';
import type { QboSourceAdapter } from './adapter';

export interface QboPullSummary {
  catalog: number;
  suppliers: number;
  ordered: number;
  inTransit: number;
  receipts: number;
  sales: number;
  errors: number;
}

/** Result shape shared by the sandbox preview + the live sync actions. */
export type QboSyncOutcome =
  | { ok: true; result: QboPullSummary; live: boolean }
  | { ok: false; error: string };

async function drain(
  adapter: QboSourceAdapter,
  kind: EntityKind,
): Promise<{ items: CanonicalPayload[]; errors: number }> {
  const items: CanonicalPayload[] = [];
  let errors = 0;
  let cursor: Cursor | null = null;

  // Bounded so a misbehaving cursor can never spin forever.
  for (let page = 0; page < 1000; page++) {
    const res: PullResult = await adapter.pull(kind, cursor, `summary:${kind}`);
    items.push(...res.items);
    errors += res.errors.length;
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return { items, errors };
}

export async function summarizeQboPull(adapter: QboSourceAdapter): Promise<QboPullSummary> {
  const products = await drain(adapter, 'product');
  const suppliers = await drain(adapter, 'supplier');
  const orders = await drain(adapter, 'purchase_order');
  const movements = await drain(adapter, 'stock_movement');

  const status = (p: CanonicalPayload) => (p.attributes as { status?: string }).status;
  const mvType = (m: CanonicalPayload) => (m.attributes as { type?: string }).type;

  return {
    catalog: products.items.length,
    suppliers: suppliers.items.length,
    ordered: orders.items.length,
    inTransit: orders.items.filter((p) => status(p) === 'sent').length,
    receipts: movements.items.filter((m) => mvType(m) === 'receipt').length,
    sales: movements.items.filter((m) => mvType(m) === 'sale').length,
    errors: products.errors + suppliers.errors + orders.errors + movements.errors,
  };
}
