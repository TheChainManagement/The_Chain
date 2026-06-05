'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { ChainState } from '@/components/ChainLink/ChainLink';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { type QboSandboxResult, runQboSandboxSync } from '../actions';
import styles from '../integrations.module.css';
import { SyncChain, type SyncLink } from './SyncChain';

/**
 * ConnectPanel — the QBO connect surface (Wave 6.1). Owns the connect CTA and the
 * chain reveal: clicking runs the real adapter against the sandbox dataset, then
 * the SUPPLIERS → ORDERED → IN TRANSIT links ignite in sequence so the operator
 * watches their QuickBooks state become a visible chain. Live OAuth replaces the
 * sandbox trigger in Wave 6.2; the reveal choreography stays.
 */

type Status = 'idle' | 'connecting' | 'syncing' | 'done' | 'error';

const TOTAL_LINKS = 3;
const REVEAL_MS = 700; // a beat longer than --duration-reveal so each ignite reads fully.

const STEPS = ['SUPPLIERS', 'ORDERED', 'IN TRANSIT'] as const;
const PENDING_LABELS = ['Vendors', 'Purchase orders', 'Open POs'] as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function linkState(index: number, stage: number): ChainState {
  if (index < stage) return 'done';
  if (index === stage) return 'active';
  return 'pending';
}

function buildLinks(
  result: QboSandboxResult | null,
  stage: number,
  revealing: boolean,
): SyncLink[] {
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
    return {
      step,
      label: labels[i] ?? '',
      when: state === 'done' ? 'synced' : undefined,
      state,
    };
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function ConnectPanel(): ReactNode {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<QboSandboxResult | null>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Drive the link-by-link reveal once a sync's counts are in.
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
    setStatus('connecting');
    setError(null);
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

  const revealing = status === 'syncing' || status === 'done';
  const links = buildLinks(result, stage, revealing);
  const busy = status === 'connecting' || status === 'syncing';

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
            and sales, and writes generated POs back. Run the sandbox preview to watch your
            operation form a chain. Live connect lands in the next release.
          </p>
        </div>
      </div>

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
        <ActionButton onClick={handleConnect} loading={busy}>
          {status === 'done' ? 'Re-run sandbox preview' : 'Run sandbox preview'}
        </ActionButton>
        {status === 'done' ? (
          <span className={styles.previewNote}>
            Preview complete. Nothing was imported. Live OAuth will import on connect.
          </span>
        ) : (
          <span className={styles.previewNote}>Sandbox data. No QuickBooks account required.</span>
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
