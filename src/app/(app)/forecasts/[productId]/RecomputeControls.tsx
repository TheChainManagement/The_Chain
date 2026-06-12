'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { recomputeForecast } from '../actions';
import styles from './forecast-detail.module.css';

/**
 * On-demand single-SKU recompute (FEATURES build step 6). Runs the same engine
 * as the batch — one targeted chunk, fresh run id — then refreshes the chart in
 * place. Owner/manager only (enforced in the action).
 */
export function RecomputeControls({ productId }: { productId: string }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function recompute() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await recomputeForecast({ productId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(
        res.totals.failed > 0
          ? 'The forecaster could not be reached — recorded as a failure.'
          : 'Forecast recomputed',
      );
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
      <ActionButton variant="primary" onClick={recompute} loading={pending}>
        Recompute forecast
      </ActionButton>
    </div>
  );
}
