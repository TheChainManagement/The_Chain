import Link from 'next/link';
import type { ReactNode } from 'react';
import { ALERT_KIND_LABEL, relativeAge } from '@/lib/alerts/format';
import type { AlertView } from '@/lib/alerts/queue';
import styles from './today.module.css';

/**
 * Recent alerts — the right-column triage strip on the dashboard. Worst-first
 * (the queue is already sorted), capped to the few that matter today; the full
 * queue lives at /flow/alerts. Each row is a one-line operator memo with its CTA.
 */
export function RecentAlerts({ alerts, nowMs }: { alerts: AlertView[]; nowMs: number }): ReactNode {
  if (alerts.length === 0) {
    return <p className={styles.railEmpty}>No open alerts. The bench is quiet.</p>;
  }

  return (
    <ul className={styles.alerts}>
      {alerts.map((a) => (
        <li key={a.id} className={styles.alert} data-severity={a.severity}>
          <span className={styles.alertRail} aria-hidden="true" />
          <div className={styles.alertBody}>
            <span className={styles.alertKind}>{ALERT_KIND_LABEL[a.kind]}</span>
            <p className={styles.alertMemo}>{a.memo}</p>
            <div className={styles.alertFoot}>
              <Link href={a.ctaHref} className={styles.alertCta}>
                {a.ctaLabel} →
              </Link>
              <span className={styles.alertAge}>{relativeAge(a.createdAt, nowMs)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
