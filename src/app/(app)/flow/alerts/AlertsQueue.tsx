'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { ALERT_KIND_LABEL, relativeAge } from '@/lib/alerts/format';
import type { AlertView } from '@/lib/alerts/queue';
import { acknowledgeAlert, dismissAlert, recomputeAlerts } from './actions';
import styles from './alerts.module.css';

const SEVERITY_LABEL = { critical: 'Critical', warn: 'Watch', info: 'Info' } as const;

/**
 * The alerts queue. Each row is the operator memo + a cobalt CTA straight to the
 * fix, with acknowledge / dismiss. A recompute control runs the durable sweep on
 * demand (it also runs after every forecast batch).
 */
export function AlertsQueue({ alerts }: { alerts: AlertView[] }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Relative age is client-only so server/client render the same first paint.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  function act(id: string, fn: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn(id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      router.refresh();
    });
  }

  function recompute() {
    setError(null);
    startTransition(async () => {
      const res = await recomputeAlerts();
      if (!res.ok) {
        setError(res.error ?? 'Could not start the sweep.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.queue}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarHint}>
          Alerts refresh after each forecast run. Recompute to sweep now.
        </span>
        <ActionButton variant="secondary" onClick={recompute} loading={pending && !busyId}>
          Recompute
        </ActionButton>
      </div>

      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}

      {alerts.length === 0 ? (
        <p className={styles.empty}>
          No open alerts. When a SKU drifts toward a stockout, an order runs late, or a sync needs
          review, the memo lands here with the fix one click away.
        </p>
      ) : (
        <ul className={styles.list}>
          {alerts.map((a) => (
            <li
              key={a.id}
              className={styles.row}
              data-severity={a.severity}
              data-testid="alert-row"
            >
              <span className={styles.lead}>
                <span className={styles.sev} data-severity={a.severity}>
                  {SEVERITY_LABEL[a.severity]}
                </span>
                <span className={styles.kind}>{ALERT_KIND_LABEL[a.kind]}</span>
              </span>
              <span className={styles.memo}>
                {a.memo}
                <span className={styles.meta}>
                  {now != null ? (
                    <span className={styles.age}>{relativeAge(a.createdAt, now)} open</span>
                  ) : null}
                  {a.reopenCount > 0 ? (
                    <span className={styles.reopen}>escalated ×{a.reopenCount}</span>
                  ) : null}
                </span>
              </span>
              <span className={styles.actions}>
                <Link href={a.ctaHref} className={styles.cta}>
                  {a.ctaLabel} →
                </Link>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => act(a.id, acknowledgeAlert)}
                  disabled={pending && busyId === a.id}
                >
                  Ack
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => act(a.id, dismissAlert)}
                  disabled={pending && busyId === a.id}
                >
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
