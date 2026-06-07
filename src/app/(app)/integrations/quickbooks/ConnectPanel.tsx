'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { ChainState } from '@/components/ChainLink/ChainLink';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { QboPullSummary } from '@/lib/qbo/summary';
import {
  disconnectQbo,
  getQboSyncProgress,
  runQboInitialSync,
  runQboSandboxSync,
  startQboConnect,
} from '../actions';
import styles from '../integrations.module.css';
import { SyncChain, type SyncLink } from './SyncChain';

/**
 * ConnectPanel — the QBO connect surface (Block 6).
 *
 * Two modes off the server-resolved connection status:
 *   - Not connected → "Connect QuickBooks" (OAuth redirect) + a sample-data
 *     preview fallback (Wave 6.1) that reveals the chain on a timer.
 *   - Connected → "Run sync" kicks the durable `qboInitialSyncWorkflow`, which
 *     writes the operator's real QuickBooks data INTO the catalog. The chain
 *     forms link by link from real phase progress (poll-driven, Wave 6.2b), and
 *     on completion the panel links straight to the freshly imported rows.
 *
 * The chain reveal (CATALOG → SUPPLIERS → SALES igniting in sequence) is shared
 * across both run paths; only what advances the stage differs (timer vs. poll).
 */

type Status = 'idle' | 'working' | 'syncing' | 'done' | 'error';
type Mode = 'sample' | 'live';

const TOTAL_LINKS = 3;
const REVEAL_MS = 700;
const POLL_MS = 1000;
const POLL_CAP = 600; // ~10 min ceiling; durable runs finish far sooner
const STEPS = ['CATALOG', 'SUPPLIERS', 'SALES'] as const;
const PENDING_LABELS = ['Items', 'Vendors', 'Sales'] as const;

/** Map a workflow phase to how many chain links should be lit. */
function phaseToStage(phase: string): number {
  switch (phase) {
    case 'product':
      return 0;
    case 'supplier':
      return 1;
    case 'stock_movement':
      return 2;
    case 'done':
      return TOTAL_LINKS;
    default:
      return 0;
  }
}

export interface ConnectPanelProps {
  connected: boolean;
  /** Whether the QBO OAuth env is set on this deploy. */
  configured: boolean;
  realmId?: string;
  lastSyncedAt: string | null;
  environment: string;
  banner: string | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function linkState(index: number, stage: number): ChainState {
  if (index < stage) return 'done';
  if (index === stage) return 'active';
  return 'pending';
}

function buildLinks(result: QboPullSummary | null, stage: number, revealing: boolean): SyncLink[] {
  const labels: string[] =
    result && revealing
      ? [
          plural(result.catalog, 'product'),
          plural(result.suppliers, 'vendor'),
          plural(result.receipts + result.sales, 'movement'),
        ]
      : [...PENDING_LABELS];

  return STEPS.map((step, i) => {
    const state = revealing ? linkState(i, stage) : 'pending';
    return { step, label: labels[i] ?? '', when: state === 'done' ? 'synced' : undefined, state };
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ERROR_COPY: Record<string, string> = {
  state_mismatch: 'That connection attempt expired. Please try connecting again.',
  forbidden: 'Only an owner or manager can connect QuickBooks.',
  session: 'Your session expired. Sign in again to connect.',
  missing_params: 'QuickBooks did not return a complete response. Try again.',
  exchange_failed: 'We could not finish connecting to QuickBooks. Try again.',
};

function bannerContent(banner: string | null): { tone: 'ok' | 'stop'; text: string } | null {
  if (!banner) return null;
  if (banner === 'connected') {
    return {
      tone: 'ok',
      text: 'QuickBooks connected. Run a sync to import your data and watch your chain form.',
    };
  }
  if (banner.startsWith('error:')) {
    const code = banner.slice(6);
    return {
      tone: 'stop',
      text: ERROR_COPY[code] ?? 'QuickBooks could not be connected. Try again.',
    };
  }
  return null;
}

export function ConnectPanel({
  connected,
  configured,
  realmId,
  lastSyncedAt,
  environment,
  banner,
}: ConnectPanelProps): ReactNode {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [mode, setMode] = useState<Mode>('live');
  const [result, setResult] = useState<QboPullSummary | null>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Guards a poll loop against setState after unmount / a superseding run.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Sample-preview reveal is timer-driven; the live sync drives its own stage
  // from poll progress, so the timer only runs in 'sample' mode.
  useEffect(() => {
    if (status !== 'syncing' || mode !== 'sample') return;
    if (stage >= TOTAL_LINKS) {
      setStatus('done');
      return;
    }
    const delay = prefersReducedMotion() ? 0 : REVEAL_MS;
    const id = setTimeout(() => setStage((s) => s + 1), delay);
    return () => clearTimeout(id);
  }, [status, mode, stage]);

  const pollLiveSync = useCallback(
    async (trackingKey: string): Promise<void> => {
      // The sync_run is created before the workflow starts, so a persistent
      // "unknown" means a real fault (missing run / bad key / RLS mismatch), not
      // just a not-yet-visible row. Tolerate a brief window, then fail fast
      // instead of spinning to the 10-minute cap.
      let unknownStreak = 0;
      for (let i = 0; i < POLL_CAP; i++) {
        if (cancelledRef.current) return;
        const progress = await getQboSyncProgress(trackingKey);
        if (cancelledRef.current) return;

        if (progress.status === 'unknown') {
          unknownStreak++;
          if (unknownStreak >= 3) {
            setError('We lost track of that sync. Please try again.');
            setStatus('error');
            return;
          }
          await sleep(POLL_MS);
          continue;
        }
        unknownStreak = 0;

        if (progress.status === 'failed') {
          setError('The sync did not finish. Please try again.');
          setStatus('error');
          return;
        }
        if (progress.status === 'running' || progress.status === 'completed') {
          setResult(progress.counts);
        }
        if (progress.status === 'running') {
          setStage(phaseToStage(progress.phase));
        }
        if (progress.status === 'completed') {
          setStage(TOTAL_LINKS);
          setStatus('done');
          router.refresh(); // freshly imported rows surface in nav + other routes
          return;
        }
        await sleep(POLL_MS);
      }
      if (!cancelledRef.current) {
        setError('The sync is taking longer than expected. Check back shortly.');
        setStatus('error');
      }
    },
    [router],
  );

  async function handleConnect(): Promise<void> {
    setStatus('working');
    setError(null);
    const outcome = await startQboConnect();
    if (!outcome.ok) {
      setError(outcome.error);
      setStatus('error');
      return;
    }
    window.location.href = outcome.url; // hand off to Intuit's consent screen
  }

  async function handleSamplePreview(): Promise<void> {
    setStatus('working');
    setError(null);
    setMode('sample');
    const outcome = await runQboSandboxSync();
    if (!outcome.ok) {
      setError(outcome.error);
      setStatus('error');
      return;
    }
    setResult(outcome.result);
    setStage(0);
    setStatus('syncing');
  }

  async function handleLiveSync(): Promise<void> {
    setStatus('working');
    setError(null);
    setMode('live');
    setResult(null);
    setStage(0);
    const outcome = await runQboInitialSync();
    if (!outcome.ok) {
      setError(outcome.error);
      setStatus('error');
      return;
    }
    setStatus('syncing');
    await pollLiveSync(outcome.trackingKey);
  }

  async function handleDisconnect(): Promise<void> {
    setStatus('working');
    setError(null);
    const outcome = await disconnectQbo();
    if (!outcome.ok) {
      setError(outcome.error ?? 'Could not disconnect.');
      setStatus('error');
      return;
    }
    router.refresh();
  }

  const revealing = status === 'syncing' || status === 'done';
  const links = buildLinks(result, stage, revealing);
  const busy = status === 'working' || status === 'syncing';
  const note = bannerContent(banner);
  const imported = status === 'done' && mode === 'live';

  return (
    <section className={styles.panel} aria-label="QuickBooks Online">
      <div className={styles.panelHead}>
        <div className={styles.panelMark} aria-hidden="true">
          qb
        </div>
        <div>
          <h2 className={styles.panelTitle}>QuickBooks Online</h2>
          <p className={styles.panelLede}>
            The native QuickBooks sync. The Chain reads your items, vendors, purchase orders, bills,
            and sales into your catalog. (Writing generated POs back is on the way.)
          </p>
          {connected ? (
            <p className={styles.connStatus}>
              <span className={styles.connDot} aria-hidden="true" />
              Connected · {environment} company {realmId ?? '—'} · last synced{' '}
              {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'never'}
            </p>
          ) : null}
        </div>
      </div>

      {note ? (
        <p
          className={note.tone === 'ok' ? styles.bannerOk : styles.error}
          role={note.tone === 'ok' ? 'status' : 'alert'}
        >
          {note.text}
        </p>
      ) : null}

      <SyncChain links={links} />

      {status === 'done' && result ? (
        <div className={styles.counts} aria-live="polite">
          <StatNumber label="Catalog" value={result.catalog} size="panel" tone="mid" />
          <StatNumber label="Suppliers" value={result.suppliers} size="panel" tone="mid" />
          <StatNumber
            label="Movements"
            value={result.receipts + result.sales}
            size="panel"
            tone="mid"
          />
          <StatNumber
            label="Errors"
            value={result.errors}
            size="panel"
            tone={result.errors > 0 ? 'stop' : 'flow'}
          />
        </div>
      ) : null}

      <div className={styles.panelActions}>
        {connected ? (
          <>
            <ActionButton onClick={handleLiveSync} loading={busy}>
              {status === 'done' ? 'Re-run sync' : 'Run sync'}
            </ActionButton>
            <ActionButton variant="secondary" onClick={handleDisconnect} disabled={busy}>
              Disconnect
            </ActionButton>
            {imported ? (
              <span className={styles.importedLinks}>
                <span className={styles.previewNote}>
                  Imported into your catalog.
                  {result && (result.skipped ?? 0) > 0
                    ? ` ${result.skipped} non-inventory ${(result.skipped ?? 0) === 1 ? 'line' : 'lines'} skipped.`
                    : ''}
                </span>
                <Link href="/inventory" className={styles.importedLink}>
                  View inventory
                </Link>
                <Link href="/suppliers" className={styles.importedLink}>
                  View suppliers
                </Link>
              </span>
            ) : (
              <span className={styles.previewNote}>
                Pulls your live QuickBooks data and imports it into your catalog.
              </span>
            )}
          </>
        ) : (
          <>
            {configured ? (
              <ActionButton onClick={handleConnect} loading={busy}>
                Connect QuickBooks
              </ActionButton>
            ) : null}
            <ActionButton variant="secondary" onClick={handleSamplePreview} disabled={busy}>
              Preview with sample data
            </ActionButton>
            <span className={styles.previewNote}>
              {configured
                ? 'Connect to import your real data, or preview the chain with a sample set.'
                : 'QuickBooks connect is not configured on this deployment yet. Preview the chain with a sample set.'}
            </span>
          </>
        )}
      </div>

      {status === 'error' && error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
