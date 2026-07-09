import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from '../../inventory.module.css';
import { CloseCount } from './CloseCount';
import { CountEntry } from './CountEntry';

export const metadata = { title: 'Count session · The Chain' };

interface SessionRow {
  id: string;
  status: 'open' | 'in_progress' | 'completed' | 'canceled';
  started_at: string;
  completed_at: string | null;
  locations: { name: string } | null;
}

interface LineRow {
  product_id: string;
  expected_qty: number | string | null;
  counted_qty: number | string | null;
  variance: number | string | null;
  products: { sku: string; name: string } | null;
}

const fmtQty = (n: number | string | null): string =>
  n === null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Count session (W2-2) — the count sheet. Enter counted SKUs one by one; the
 * close posts every drift to the stock ledger and completes the session. After
 * close the sheet becomes the variance report (counted vs expected, signed).
 */
export default async function CountSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<ReactNode> {
  const { sessionId } = await params;
  const supabase = await createSupabaseServer();

  const { data: session } = await supabase
    .from('cycle_count_sessions')
    .select('id, status, started_at, completed_at, locations(name)')
    .eq('id', sessionId)
    .maybeSingle<SessionRow>();
  if (!session) notFound();

  const { data } = await supabase
    .from('cycle_count_lines')
    .select('product_id, expected_qty, counted_qty, variance, products(sku, name)')
    .eq('session_id', sessionId)
    .returns<LineRow[]>();
  const lines = (data ?? []).sort((a, b) =>
    (a.products?.sku ?? '').localeCompare(b.products?.sku ?? ''),
  );

  const open = session.status === 'open' || session.status === 'in_progress';

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow={`Count session · ${session.locations?.name ?? 'storeroom'}`}
        title={open ? 'Counting' : 'Variance report'}
        actions={
          <div className={pageStyles.headerActions}>
            <Link href="/inventory/cycle-counts" className={pageStyles.headerLink}>
              All counts
            </Link>
          </div>
        }
      />

      {open ? <CountEntry sessionId={sessionId} /> : null}

      {lines.length === 0 ? (
        <Panel
          prefix="Count sheet"
          title="Nothing counted yet"
          empty
          emptyMessage="Enter the first SKU and its counted quantity above. Expected quantity snapshots when the line is recorded."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.countLineHead} aria-hidden="true">
            <span>SKU</span>
            <span>Product</span>
            <span className={styles.opNum}>Expected</span>
            <span className={styles.opNum}>Counted</span>
            <span className={styles.opNum}>Variance</span>
          </div>
          {lines.map((l) => {
            const variance = open
              ? l.counted_qty === null || l.expected_qty === null
                ? null
                : Number(l.counted_qty) - Number(l.expected_qty)
              : l.variance === null
                ? null
                : Number(l.variance);
            return (
              <div key={l.product_id} className={styles.countLineRow}>
                <span className={styles.opSku}>{l.products?.sku ?? '—'}</span>
                <span className={styles.opName}>{l.products?.name ?? '—'}</span>
                <span className={styles.opNum}>{fmtQty(l.expected_qty)}</span>
                <span className={styles.opNum}>{fmtQty(l.counted_qty)}</span>
                <span
                  className={`${styles.opNum} ${
                    variance === null || variance === 0
                      ? styles.varianceZero
                      : variance > 0
                        ? styles.variancePlus
                        : styles.varianceMinus
                  }`}
                >
                  {variance === null ? '—' : `${variance > 0 ? '+' : ''}${fmtQty(variance)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {open && lines.length > 0 ? <CloseCount sessionId={sessionId} /> : null}
    </div>
  );
}
