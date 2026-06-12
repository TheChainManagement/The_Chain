'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { BatchRunRow } from '@/lib/forecast/queries';
import { type ForecastBatchProgress, getForecastBatchProgress, runForecastBatch } from './actions';
import styles from './forecasts.module.css';

/**
 * Batch controls for the forecasts cockpit (Block 8 Wave 2b): run the durable
 * batch and watch the shard fleet fill. Owner/manager only (enforced in the
 * action); anyone else gets the error inline.
 *
 * The memorable element this wave is the SHARD FLEET — the batch renders as a
 * row of shard tiles that fill left-to-right as coverage lands. One glance says
 * how much of the catalog has a fresh forecast. Deep slate fills on hairline
 * tracks; cobalt stays on the Run CTA (its one slot here).
 */

const POLL_MS = 2000;
const MAX_QUIET_POLLS = 150; // ~5 min of no state change before we hand off softly

export function ForecastBatchControls({
  running,
  latest,
}: {
  running: BatchRunRow | null;
  latest: BatchRunRow | null;
}): ReactNode {
  const router = useRouter();
  const [trackingKey, setTrackingKey] = useState<string | null>(running?.trackingKey ?? null);
  const [progress, setProgress] = useState<ForecastBatchProgress | null>(
    running
      ? {
          status: 'running',
          processed: running.processed,
          total: running.total,
          shards: running.shards,
          concurrency: 0,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const quietPolls = useRef(0);

  const begin = useCallback(() => {
    setError(null);
    setStarting(true);
    void (async () => {
      const res = await runForecastBatch({});
      setStarting(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      quietPolls.current = 0;
      setProgress({ status: 'running', processed: 0, total: 0, shards: 0, concurrency: 0 });
      setTrackingKey(res.trackingKey);
    })();
  }, []);

  const progressStatus = progress?.status ?? null;

  useEffect(() => {
    if (!trackingKey) return;
    if (progressStatus !== null && progressStatus !== 'running') return;

    const timer = setInterval(() => {
      void (async () => {
        const next = await getForecastBatchProgress({ trackingKey });
        if (next.status === 'unknown') {
          quietPolls.current += 1;
          if (quietPolls.current > MAX_QUIET_POLLS) {
            clearInterval(timer);
            setError('Lost track of the batch — refresh to check its status.');
            setTrackingKey(null);
          }
          return;
        }
        setProgress(next);
        if (next.status !== 'running') {
          clearInterval(timer);
          router.refresh();
        }
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [trackingKey, progressStatus, router]);

  const isRunning = progress?.status === 'running';

  return (
    <div className={styles.controls}>
      <div className={styles.controlsMeta}>
        <span className={styles.metaLabel}>Last batch</span>
        <span className={styles.metaValue}>{describeLast(latest, progress)}</span>
      </div>

      {isRunning && progress.status === 'running' ? (
        <ShardFleet
          processed={progress.processed}
          total={progress.total}
          shards={progress.shards}
        />
      ) : null}

      <div className={styles.controlsActions}>
        {progress?.status === 'completed' ? (
          <span className={styles.doneNote}>
            {progress.totals.modeled + progress.totals.benchmarked} forecasts ·{' '}
            {progress.totals.promoted} promoted
          </span>
        ) : null}
        {progress?.status === 'failed' ? (
          <span className={styles.controlsError} role="alert">
            {progress.error}
          </span>
        ) : null}
        {error ? (
          <span className={styles.controlsError} role="alert">
            {error}
          </span>
        ) : null}
        <ActionButton variant="primary" onClick={begin} loading={starting || isRunning}>
          {isRunning ? 'Forecasting…' : 'Run forecast batch'}
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * The shard fleet: one tile per shard (the 200-SKU unit of the durable batch),
 * filling as coverage lands. Capped at 40 tiles so a 50k-SKU tenant still reads
 * as a ribbon, not a wall.
 */
export function ShardFleet({
  processed,
  total,
  shards,
}: {
  processed: number;
  total: number;
  shards: number;
}): ReactNode {
  const tiles = Math.max(1, Math.min(shards || 1, 40));
  const share = total > 0 ? Math.min(1, processed / total) : 0;
  const filled = Math.floor(share * tiles);
  const partial = share * tiles - filled;

  return (
    <div
      className={styles.fleet}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total || undefined}
      aria-valuenow={processed}
      aria-label="Forecast batch progress"
      data-testid="shard-fleet"
    >
      <div className={styles.fleetTiles}>
        {Array.from({ length: tiles }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positional by design
            key={i}
            className={styles.fleetTile}
            data-fill={i < filled ? 'full' : i === filled && partial > 0 ? 'partial' : 'empty'}
          />
        ))}
      </div>
      <span className={styles.fleetCount}>
        {processed}/{total || '—'} SKUs
      </span>
    </div>
  );
}

function describeLast(latest: BatchRunRow | null, progress: ForecastBatchProgress | null): string {
  if (progress?.status === 'running') return 'running now';
  if (!latest?.finishedAt) return 'never';
  const then = Date.parse(latest.finishedAt);
  if (Number.isNaN(then)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  const when =
    mins < 1
      ? 'just now'
      : mins < 60
        ? `${mins} min ago`
        : mins < 1440
          ? `${Math.round(mins / 60)} hr ago`
          : `${Math.round(mins / 1440)} days ago`;
  return latest.status === 'failed' ? `${when} · did not finish` : when;
}
