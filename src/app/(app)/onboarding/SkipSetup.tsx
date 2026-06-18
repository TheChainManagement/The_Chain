'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { seedOnlyOptIn } from './actions';
import styles from './onboarding.module.css';

/**
 * Seed-only opt-in — the only sanctioned way past the minimums (acceptance
 * criterion). Owner-gated and audit-logged in the action. A quiet text
 * affordance, never competing with the primary chain CTA.
 */
export function SkipSetup(): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function skip() {
    setError(null);
    startTransition(async () => {
      const result = await seedOnlyOptIn();
      if (result.ok) {
        router.push('/today');
      } else {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  return (
    <div className={styles.skip}>
      {confirming ? (
        <span className={styles.skipConfirm}>
          Skip setup and go to an empty bench?{' '}
          <button type="button" className={styles.skipYes} onClick={skip} disabled={pending}>
            {pending ? 'Skipping…' : 'Yes, skip'}
          </button>{' '}
          <button
            type="button"
            className={styles.skipNo}
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Keep setting up
          </button>
        </span>
      ) : (
        <button type="button" className={styles.skipLink} onClick={() => setConfirming(true)}>
          Skip setup for now
        </button>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
