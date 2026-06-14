import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { listOpenAlerts, openAlertCounts } from '@/lib/alerts/queue';
import { listPendingConflicts } from '@/lib/qbo/conflicts';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './flow.module.css';

export const metadata = { title: 'Flow · The Chain' };

/**
 * Flow hub — the operations surface. Open alerts and sync conflicts stream
 * through here; the audit trail joins them once it ships. Each card carries its
 * live count so the operator sees what needs attention before clicking in.
 */
export default async function FlowPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const [alerts, conflicts] = await Promise.all([
    listOpenAlerts(supabase),
    listPendingConflicts(supabase),
  ]);
  const counts = openAlertCounts(alerts);

  const alertHint =
    alerts.length === 0
      ? 'Nothing open'
      : [counts.critical && `${counts.critical} critical`, counts.warn && `${counts.warn} to watch`]
          .filter(Boolean)
          .join(' · ') || `${alerts.length} open`;

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Operations" title="Flow" />
      <Panel prefix="Surfaces" title="What needs attention">
        <ul className={styles.cards}>
          <li>
            <Link
              href="/flow/alerts"
              className={styles.card}
              data-tone={counts.critical ? 'critical' : counts.warn ? 'warn' : 'calm'}
            >
              <span className={styles.cardKey}>Alerts</span>
              <span className={styles.cardCount}>{alerts.length}</span>
              <span className={styles.cardHint}>{alertHint}</span>
            </Link>
          </li>
          <li>
            <Link
              href="/flow/sync-conflicts"
              className={styles.card}
              data-tone={conflicts.length ? 'warn' : 'calm'}
            >
              <span className={styles.cardKey}>Sync conflicts</span>
              <span className={styles.cardCount}>{conflicts.length}</span>
              <span className={styles.cardHint}>
                {conflicts.length === 0 ? 'Everything reconciles' : 'Need review'}
              </span>
            </Link>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
