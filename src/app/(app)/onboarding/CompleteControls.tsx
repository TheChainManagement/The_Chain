'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { getForecastBatchProgress } from '@/app/(app)/forecasts/actions';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { completeOnboarding, finishOnboarding } from './actions';
import styles from './onboarding.module.css';

/**
 * The final step — kick the first forecast (reusing the durable
 * forecastTenantBatchWorkflow), poll until it lands, stamp completed_at, and walk
 * the operator onto /today. While it runs, the "preparing your workshop" panel
 * shows shimmer skeletons (FEATURES step 6).
 */

type Phase = 'idle' | 'running' | 'finishing' | 'error';

const POLL_MS = 1500;

export function CompleteControls(): ReactNode {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const land = useCallback(async () => {
    setPhase('finishing');
    // The batch sets first_forecast_ready_at during finalize; allow a couple of
    // retries for the stamp to land before giving up.
    for (let attempt = 0; attempt < 3; attempt++) {
      const done = await finishOnboarding();
      if (done.ok) {
        router.push('/today');
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    setPhase('error');
    setError('The forecast finished but we could not open your bench. Refresh to continue.');
  }, [router]);

  const poll = useCallback(
    (trackingKey: string) => {
      timer.current = setTimeout(async () => {
        const progress = await getForecastBatchProgress({ trackingKey });
        if (progress.status === 'completed') {
          await land();
        } else if (progress.status === 'failed') {
          setPhase('error');
          setError('The first forecast did not finish. You can try again.');
        } else {
          poll(trackingKey);
        }
      }, POLL_MS);
    },
    [land],
  );

  function start() {
    setError(null);
    setPhase('running');
    completeOnboarding().then((result) => {
      if (!result.ok) {
        setPhase('error');
        setError(result.error);
        return;
      }
      poll(result.trackingKey);
    });
  }

  if (phase === 'running' || phase === 'finishing') {
    return (
      <div className={styles.preparing} role="status" aria-live="polite">
        <p className={styles.preparingLead}>
          {phase === 'finishing'
            ? 'Opening your bench…'
            : 'Building your first forecast and reorder points…'}
        </p>
        <div className={styles.shimmer} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.completeGroup}>
      <ActionButton onClick={start}>Run my first forecast</ActionButton>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
