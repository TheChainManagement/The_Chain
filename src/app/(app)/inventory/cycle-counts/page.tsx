import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from '../inventory.module.css';
import { StartCount } from './StartCount';

export const metadata = { title: 'Cycle counts · The Chain' };

interface SessionRow {
  id: string;
  status: 'open' | 'in_progress' | 'completed' | 'canceled';
  started_at: string;
  completed_at: string | null;
  locations: { name: string } | null;
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Cycle counts (W2-2) — storeroom hygiene. Lists count sessions; a session is
 * opened, counted SKU by SKU, then CLOSED — and the close posts the variance
 * to the stock ledger (the schema was wired for this since Wave 1; W2-2 turns
 * the reconciliation on).
 */
export default async function CycleCountsPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from('cycle_count_sessions')
    .select('id, status, started_at, completed_at, locations(name)')
    .order('started_at', { ascending: false })
    .limit(50)
    .returns<SessionRow[]>();
  const sessions = data ?? [];

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Storeroom hygiene · count → reconcile"
        title="Cycle counts"
        actions={
          <div className={pageStyles.headerActions}>
            <Link href="/inventory" className={pageStyles.headerLink}>
              Back to inventory
            </Link>
            <StartCount />
          </div>
        }
      />

      {sessions.length === 0 ? (
        <Panel
          prefix="Counts"
          title="No count sessions yet"
          empty
          emptyMessage="Start a count, walk the shelves, and the close posts every variance straight to the stock ledger."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.countHead} aria-hidden="true">
            <span>Session</span>
            <span>Location</span>
            <span>Status</span>
            <span>Started</span>
            <span>Completed</span>
          </div>
          {sessions.map((s) => (
            <div key={s.id} className={styles.countRow}>
              <Link href={`/inventory/cycle-counts/${s.id}`} className={styles.cellSkuLink}>
                {s.id.slice(0, 8)}
              </Link>
              <span>{s.locations?.name ?? '—'}</span>
              <span className={styles.countStatus}>
                {s.status === 'completed' ? 'Completed' : 'Open'}
              </span>
              <span>{fmtDate(s.started_at)}</span>
              <span>{s.completed_at ? fmtDate(s.completed_at) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
