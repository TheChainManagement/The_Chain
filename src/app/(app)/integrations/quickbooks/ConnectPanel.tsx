'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { ChainState } from '@/components/ChainLink/ChainLink';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { QboPullSummary } from '@/lib/qbo/summary';
import { disconnectQbo, runQboLiveSync, runQboSandboxSync, startQboConnect } from '../actions';
import styles from '../integrations.module.css';
import { SyncChain, type SyncLink } from './SyncChain';

/**
 * ConnectPanel — the QBO connect surface (Block 6 Wave 6.2).
 *
 * Two modes off the server-resolved connection status:
 *   - Not connected → "Connect QuickBooks" (OAuth redirect) + a sample-data
 *     preview fallback (Wave 6.1).
 *   - Connected → "Run sync" pulls the operator's REAL data and the chain forms
 *     from it; "Disconnect" revokes. (Durable write-into-catalog is Wave 6.2b.)
 *
 * The chain reveal (SUPPLIERS → ORDERED → IN TRANSIT igniting in sequence) is
 * shared across both run paths.
 */

type Status = 'idle' | 'working' | 'syncing' | 'done' | 'error';

const TOTAL_LINKS = 3;
const REVEAL_MS = 700;
const STEPS = ['SUPPLIERS', 'ORDERED', 'IN TRANSIT'] as const;
const PENDING_LABELS = ['Vendors', 'Purchase orders', 'Open POs'] as const;

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
          plural(result.suppliers, 'vendor'),
          plural(result.ordered, 'order'),
          result.inTransit > 0 ? `${result.inTransit} open` : 'All received',
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
    return { tone: 'ok', text: 'QuickBooks connected. Run a sync to watch your chain form.' };
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
  const [result, setResult] = useState<QboPullSummary | null>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'syncing') return;
    if (stage >= TOTAL_LINKS) {
      setStatus('done');
      return;
    }
    const delay = prefersReducedMotion() ? 0 : REVEAL_MS;
    const id = setTimeout(() => setStage((s) => s + 1), delay);
    return () => clearTimeout(id);
  }, [status, stage]);

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

  async function handleSync(live: boolean): Promise<void> {
    setStatus('working');
    setError(null);
    const outcome = live ? await runQboLiveSync() : await runQboSandboxSync();
    if (!outcome.ok) {
      setError(outcome.error);
      setStatus('error');
      return;
    }
    setResult(outcome.result);
    setStage(0);
    setStatus('syncing');
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

  return (
    <section className={styles.panel} aria-label="QuickBooks Online">
      <div className={styles.panelHead}>
        <div className={styles.panelMark} aria-hidden="true">
          qb
        </div>
        <div>
          <h2 className={styles.panelTitle}>QuickBooks Online</h2>
          <p className={styles.panelLede}>
            The native two-way sync. The Chain reads your items, vendors, purchase orders, bills,
            and sales, and writes generated POs back.
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
          <StatNumber label="Receipts" value={result.receipts} size="panel" tone="mid" />
          <StatNumber label="Sales" value={result.sales} size="panel" tone="mid" />
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
            <ActionButton onClick={() => handleSync(true)} loading={busy}>
              {status === 'done' ? 'Re-run sync' : 'Run sync'}
            </ActionButton>
            <ActionButton variant="secondary" onClick={handleDisconnect} disabled={busy}>
              Disconnect
            </ActionButton>
            <span className={styles.previewNote}>
              {status === 'done'
                ? 'Read-only preview of your QuickBooks. Importing into your catalog is the next release.'
                : 'Pulls your live QuickBooks data. Nothing is written back.'}
            </span>
          </>
        ) : (
          <>
            {configured ? (
              <ActionButton onClick={handleConnect} loading={busy}>
                Connect QuickBooks
              </ActionButton>
            ) : null}
            <ActionButton variant="secondary" onClick={() => handleSync(false)} disabled={busy}>
              Preview with sample data
            </ActionButton>
            <span className={styles.previewNote}>
              {configured
                ? 'Connect to sync your real data, or preview the chain with a sample set.'
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
