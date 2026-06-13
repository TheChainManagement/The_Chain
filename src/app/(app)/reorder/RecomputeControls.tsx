'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { recomputeReorders } from './actions';
import styles from './reorder.module.css';

/**
 * Recompute the reorder queue from the current policy + on-hand (owner/manager).
 * The batch generates recommendations automatically; this is the manual refresh.
 */
export function RecomputeControls(): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function recompute() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      const res = await recomputeReorders({});
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const s = res.summary;
      setNote(`${s.open} to reorder · ${s.created} new · ${s.expired} cleared`);
      router.refresh();
    });
  }

  return (
    <div className={styles.recompute}>
      {note ? <span className={styles.recomputeNote}>{note}</span> : null}
      {error ? (
        <span className={styles.recomputeError} role="alert">
          {error}
        </span>
      ) : null}
      <ActionButton variant="secondary" onClick={recompute} loading={pending}>
        Recompute
      </ActionButton>
    </div>
  );
}
