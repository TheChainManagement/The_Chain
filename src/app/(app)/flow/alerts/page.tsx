import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { listOpenAlerts, openAlertCounts } from '@/lib/alerts/queue';
import { createSupabaseServer } from '@/lib/supabase/server';
import { AlertsQueue } from './AlertsQueue';

export const metadata = { title: 'Alerts · The Chain' };

/**
 * Alerts queue (in-app alerts engine). Server shell: RLS-scoped open alerts,
 * worst-first, handed to the interactive queue. Each alert is its own one-line
 * operator memo with a single cobalt CTA to the fix — the memorable element.
 */
export default async function AlertsPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const alerts = await listOpenAlerts(supabase);
  const counts = openAlertCounts(alerts);

  const summary =
    alerts.length === 0
      ? 'Nothing open'
      : [
          counts.critical ? `${counts.critical} critical` : null,
          counts.warn ? `${counts.warn} to watch` : null,
          counts.info ? `${counts.info} for info` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Flow · alerts" title="Alerts" />
      <Panel prefix="Open" title={summary}>
        <AlertsQueue alerts={alerts} />
      </Panel>
    </div>
  );
}
