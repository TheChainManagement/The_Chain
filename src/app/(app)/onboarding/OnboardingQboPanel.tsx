'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  getQboSyncProgress,
  runQboInitialSync,
  startQboConnect,
} from '@/app/(app)/integrations/actions';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { qboPhaseStage } from '@/lib/onboarding/state';
import styles from './onboarding.module.css';
import { QboPhaseTracker } from './QboPhaseTracker';

/**
 * Inline QuickBooks connect + first-sync, in the onboarding chain (Block 2 Wave 2b).
 * Reuses the Block 6 actions (startQboConnect → OAuth, runQboInitialSync →
 * durable workflow, getQboSyncProgress → poller). The OAuth callback returns to
 * /onboarding, so the operator never leaves the flow. When the sync lands, we
 * refresh the route and the onboarding chain advances from the real counts.
 */

const POLL_MS = 1200;
const MAX_POLLS = 600;

type Phase = 'idle' | 'connecting' | 'syncing' | 'done' | 'error';

export function OnboardingQboPanel({
  connected,
  configured,
}: {
  connected: boolean;
  configured: boolean;
}): ReactNode {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(
    (trackingKey: string, attempt: number) => {
      timer.current = setTimeout(async () => {
        const progress = await getQboSyncProgress(trackingKey);
        if (progress.status === 'completed') {
          setStage(3);
          setPhase('done');
          router.refresh();
        } else if (progress.status === 'failed') {
          setPhase('error');
          setError('The sync did not finish. You can try again.');
        } else if (progress.status === 'unknown' || attempt >= MAX_POLLS) {
          setPhase('error');
          setError('We lost track of the sync. Refresh to see what landed.');
        } else {
          setStage(qboPhaseStage(progress.phase));
          poll(trackingKey, attempt + 1);
        }
      }, POLL_MS);
    },
    [router],
  );

  function connect() {
    setError(null);
    setPhase('connecting');
    startQboConnect().then((result) => {
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setPhase('error');
        setError(result.error);
      }
    });
  }

  function sync() {
    setError(null);
    setPhase('syncing');
    setStage(0);
    runQboInitialSync().then((result) => {
      if (result.ok) {
        poll(result.trackingKey, 0);
      } else {
        setPhase('error');
        setError(result.error);
      }
    });
  }

  if (!configured) {
    return (
      <p className={styles.stepLead}>
        QuickBooks isn&rsquo;t available on this workshop yet. You can import a spreadsheet or start
        fresh instead — pick another path above.
      </p>
    );
  }

  if (!connected) {
    return (
      <div className={styles.completeGroup}>
        <p className={styles.stepLead}>
          Connect QuickBooks Online and The Chain reads your items, vendors, and purchase history.
          You&rsquo;ll come right back here and watch the chain fill.
        </p>
        <ActionButton onClick={connect} loading={phase === 'connecting'}>
          {phase === 'connecting' ? 'Opening QuickBooks' : 'Connect QuickBooks'}
        </ActionButton>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (phase === 'syncing' || phase === 'done') {
    return (
      <div className={styles.preparing} role="status" aria-live="polite">
        <p className={styles.preparingLead}>
          {phase === 'done'
            ? 'Pulled from QuickBooks — opening your bench…'
            : 'Pulling from QuickBooks…'}
        </p>
        <QboPhaseTracker stage={stage} done={phase === 'done'} />
      </div>
    );
  }

  return (
    <div className={styles.completeGroup}>
      <p className={styles.stepLead}>
        QuickBooks is connected. Pull your catalog, suppliers, and history — the chain fills as each
        lands.
      </p>
      <ActionButton onClick={sync}>Pull my data from QuickBooks</ActionButton>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
