import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { WeeklyChangeInsightPanel } from '@/components/InsightPanel/WeeklyChangeInsightPanel';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { listOpenAlerts, openAlertCounts } from '@/lib/alerts/queue';
import { assembleWeeklyChangeFacts, weeklyWindowStart } from '@/lib/insights/weekly-change';
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
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = (claims?.claims?.tenant_id as string | undefined) ?? '';
  const [alerts, conflicts, week] = await Promise.all([
    listOpenAlerts(supabase),
    listPendingConflicts(supabase),
    // The same four counts the weekly digest narrates — rendered here so every
    // number Claude states is verifiable on-screen (trust hierarchy).
    assembleWeeklyChangeFacts(supabase, tenantId, weeklyWindowStart(Date.now())),
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

      {/* This week — the counts the digest narrates, on-screen and verifiable. */}
      <div className={pageStyles.strip}>
        <MetricCell label="ALERTS RAISED" value={week.alertsRaised} />
        <MetricCell label="REORDER FLAGS" value={week.reordersFlagged} />
        <MetricCell label="RECEIPTS" value={week.receiptsLogged} />
        <MetricCell label="CONFLICTS PENDING" value={week.conflictsPending} />
      </div>

      <WeeklyChangeInsightPanel />
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
