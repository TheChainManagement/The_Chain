'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { PendingConflict } from '@/lib/qbo/conflicts';
import type { ResolutionChoice } from '@/lib/qbo/resolve';
import { resolveSyncConflict } from './actions';
import styles from './sync-conflicts.module.css';

type Side = 'local' | 'remote';

const RECONCILE_NOTE: Record<ResolutionChoice, string> = {
  accept_local: 'Kept your record',
  accept_remote: 'Took QuickBooks',
  merge: 'Merged field by field',
};

/**
 * The reconciliation cockpit. Each conflict is a bench with two diverged columns
 * — YOUR RECORD vs QUICKBOOKS — diffed field by field. The operator keeps one
 * side, takes the other, or drops into merge mode to pick a winner per field.
 *
 * Memorable moment: on resolve, the two columns converge into one settled cobalt
 * chain link (the project's signature object) before the row clears — the visible
 * proof that the divergence is gone.
 */
export function ConflictCockpit({ conflicts }: { conflicts: PendingConflict[] }): ReactNode {
  const [open, setOpen] = useState(conflicts);

  function remove(id: string) {
    setOpen((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className={styles.cockpit}>
      <p className={styles.lede} role="status">
        <span className={styles.ledeCount}>{open.length}</span>{' '}
        {open.length === 1 ? 'record needs' : 'records need'} a decision. Each one changed in both
        QuickBooks and The Chain since the last sync.
      </p>
      <div className={styles.benchList}>
        {open.map((c) => (
          <ConflictBench key={c.id} conflict={c} onResolved={() => remove(c.id)} />
        ))}
      </div>
    </div>
  );
}

function ConflictBench({
  conflict,
  onResolved,
}: {
  conflict: PendingConflict;
  onResolved: () => void;
}): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ResolutionChoice | null>(null);
  // Per-field merge picks, defaulted to the operator's own values.
  const [picks, setPicks] = useState<Record<string, Side>>(() =>
    Object.fromEntries(conflict.fields.map((f) => [f.key, 'local' as Side])),
  );

  function commit(resolution: ResolutionChoice) {
    setError(null);
    const mergePayload =
      resolution === 'merge'
        ? Object.fromEntries(
            conflict.fields.map((f) => [
              f.key,
              picks[f.key] === 'remote' ? conflict.remoteState[f.key] : conflict.localState[f.key],
            ]),
          )
        : undefined;

    startTransition(async () => {
      const res = await resolveSyncConflict({ conflictId: conflict.id, resolution, mergePayload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Play the reconcile beat, then clear the row and refresh the badge count.
      setReconciled(resolution);
      window.setTimeout(() => {
        onResolved();
        router.refresh();
      }, 1100);
    });
  }

  if (reconciled) {
    return (
      <section className={styles.reconciled} aria-live="polite">
        <span className={styles.reconciledLink} aria-hidden="true" />
        <div className={styles.reconciledText}>
          <span className={styles.reconciledStep}>RECONCILED</span>
          <span className={styles.reconciledLabel}>{conflict.title}</span>
          <span className={styles.reconciledNote}>{RECONCILE_NOTE[reconciled]}</span>
        </div>
      </section>
    );
  }

  const diffCount = conflict.fields.filter((f) => f.differs).length;

  return (
    <section className={styles.bench} data-merging={merging || undefined}>
      <header className={styles.benchHead}>
        <div className={styles.benchTitleGroup}>
          <span className={styles.benchKind}>{conflict.entityType}</span>
          <h2 className={styles.benchTitle}>{conflict.title}</h2>
          {conflict.subtitle ? <span className={styles.benchSub}>{conflict.subtitle}</span> : null}
        </div>
        <span className={styles.diffTag}>
          {diffCount} {diffCount === 1 ? 'field differs' : 'fields differ'}
        </span>
      </header>

      <div className={styles.benchColumns}>
        <div className={styles.colHead} data-side="local">
          Your record
        </div>
        <div className={styles.colHead} data-side="remote">
          QuickBooks
        </div>

        {conflict.fields.map((f) => (
          <div key={f.key} className={styles.fieldRow} data-differs={f.differs || undefined}>
            <span className={styles.fieldLabel}>{f.label}</span>
            <button
              type="button"
              className={styles.cell}
              data-side="local"
              data-chosen={merging && f.differs && picks[f.key] === 'local' ? 'true' : undefined}
              data-pickable={merging && f.differs ? 'true' : undefined}
              onClick={
                merging && f.differs
                  ? () => setPicks((p) => ({ ...p, [f.key]: 'local' }))
                  : undefined
              }
              disabled={!merging || !f.differs}
            >
              {f.local}
            </button>
            <button
              type="button"
              className={styles.cell}
              data-side="remote"
              data-chosen={merging && f.differs && picks[f.key] === 'remote' ? 'true' : undefined}
              data-pickable={merging && f.differs ? 'true' : undefined}
              onClick={
                merging && f.differs
                  ? () => setPicks((p) => ({ ...p, [f.key]: 'remote' }))
                  : undefined
              }
              disabled={!merging || !f.differs}
            >
              {f.remote}
            </button>
          </div>
        ))}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <footer className={styles.benchActions}>
        {merging ? (
          <>
            <span className={styles.mergeHint}>
              Tap a cell to choose the winning value for each field.
            </span>
            <div className={styles.actionRow}>
              <ActionButton
                variant="secondary"
                onClick={() => setMerging(false)}
                disabled={pending}
              >
                Cancel
              </ActionButton>
              <ActionButton variant="primary" onClick={() => commit('merge')} loading={pending}>
                Save merge
              </ActionButton>
            </div>
          </>
        ) : (
          <div className={styles.actionRow}>
            <ActionButton
              variant="secondary"
              onClick={() => commit('accept_local')}
              loading={pending}
            >
              Keep yours
            </ActionButton>
            <ActionButton
              variant="secondary"
              onClick={() => commit('accept_remote')}
              loading={pending}
            >
              Take QuickBooks
            </ActionButton>
            <ActionButton variant="primary" onClick={() => setMerging(true)} disabled={pending}>
              Merge
            </ActionButton>
          </div>
        )}
      </footer>
    </section>
  );
}
