'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { recomputeClassifications } from './actions';
import styles from './classification.module.css';

/**
 * Recompute control for the classification cockpit. Runs the tenant ABC/XYZ
 * engine and refreshes the grid in place. Owner/manager only (enforced in the
 * action); a non-privileged caller gets the error inline.
 */
export function ClassificationControls({ computedAt }: { computedAt: string | null }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function recompute() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await recomputeClassifications();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.classified);
      router.refresh();
    });
  }

  return (
    <div className={styles.controls}>
      <div className={styles.controlsMeta}>
        <span className={styles.metaLabel}>Last computed</span>
        <span className={styles.metaValue}>{relativeTime(computedAt)}</span>
      </div>
      <div className={styles.controlsActions}>
        {done != null ? <span className={styles.recomputed}>{done} SKUs classified</span> : null}
        {error ? (
          <span className={styles.controlsError} role="alert">
            {error}
          </span>
        ) : null}
        <ActionButton variant="primary" onClick={recompute} loading={pending}>
          Recompute
        </ActionButton>
      </div>
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
