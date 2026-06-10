'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import {
  getQboIncrementalResult,
  type QboIncrementalResult,
  runQboIncrementalSync,
} from '../actions';
import styles from '../integrations.module.css';

/**
 * IncrementalSyncControls (Block 6, Wave 6.3-B) — the "kept in sync" strip on a
 * connected QuickBooks. Shows when the data was last refreshed, that it auto-syncs
 * every 15 minutes, and a manual "Sync now" that runs the same durable delta the
 * cron does. After a run it reports what changed; a pending-conflict count flags
 * changes the operator will resolve (the /flow/sync-conflicts surface is Wave 6.3-C).
 */

type Summary = Extract<QboIncrementalResult, { status: 'completed' }>['summary'];

const POLL_MS = 1000;
const POLL_CAP = 120;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function IncrementalSyncControls({
  lastSyncedAt,
  pendingConflicts,
}: {
  lastSyncedAt: string | null;
  pendingConflicts: number;
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const syncNow = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const started = await runQboIncrementalSync();
      if (!started.ok) {
        setError(started.error);
        return;
      }
      for (let i = 0; i < POLL_CAP; i++) {
        await sleep(POLL_MS);
        const r = await getQboIncrementalResult(started.trackingKey);
        if (r.status === 'completed') {
          setSummary(r.summary);
          router.refresh(); // refresh last-synced + conflict count
          return;
        }
        if (r.status === 'failed') {
          setError(r.error);
          return;
        }
      }
      setError('The sync is taking longer than expected. Check back shortly.');
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [router]);

  const changed = summary ? summary.inserted + summary.updated + summary.movements : 0;

  return (
    <section className={styles.freshness} aria-label="Keep QuickBooks in sync">
      <div className={styles.freshnessHead}>
        <div className={styles.freshnessMeta}>
          <span className={styles.freshnessLabel}>Last synced</span>
          <span className={styles.freshnessValue}>{relativeTime(lastSyncedAt)}</span>
          <span className={styles.freshnessCadence}>· auto-syncs every 15 minutes</span>
        </div>
        <ActionButton variant="secondary" onClick={syncNow} loading={busy}>
          Sync now
        </ActionButton>
      </div>

      {pendingConflicts > 0 ? (
        <p className={styles.conflictBadge} role="status">
          <span className={styles.conflictDot} aria-hidden="true" />
          {pendingConflicts} {pendingConflicts === 1 ? 'change needs' : 'changes need'} review
        </p>
      ) : null}

      {summary ? (
        <div className={styles.deltaCounts} aria-live="polite">
          <StatNumber label="Updated" value={summary.updated} size="panel" tone="mid" />
          <StatNumber label="New" value={summary.inserted} size="panel" tone="mid" />
          <StatNumber label="Movements" value={summary.movements} size="panel" tone="mid" />
          <StatNumber
            label="Conflicts"
            value={summary.needsReview}
            size="panel"
            tone={summary.needsReview > 0 ? 'warn' : 'flow'}
          />
        </div>
      ) : null}

      {summary && changed === 0 && summary.needsReview === 0 ? (
        <p className={styles.freshnessNote}>Already up to date. Nothing changed in QuickBooks.</p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
