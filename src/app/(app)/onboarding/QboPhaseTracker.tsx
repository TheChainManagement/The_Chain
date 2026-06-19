import type { ReactNode } from 'react';
import styles from './onboarding.module.css';

/**
 * QBO sync phase tracker (Block 2 Wave 2b) — the memorable element of the QBO
 * onboarding path. As the initial sync runs, Catalog → Suppliers → Sales light
 * cobalt one by one (driven by the workflow cursor via qboPhaseStage). Row i is
 * `done` when stage passes it, `active` at the frontier, `pending` ahead.
 * Presentational so it renders deterministically in the memorable artifact.
 */

export const QBO_PHASE_ROWS = ['Catalog', 'Suppliers', 'Sales history'] as const;

export function QboPhaseTracker({ stage, done }: { stage: number; done: boolean }): ReactNode {
  return (
    <ol className={styles.phaseList}>
      {QBO_PHASE_ROWS.map((row, i) => {
        const state = done || stage > i ? 'done' : stage === i ? 'active' : 'pending';
        return (
          <li key={row} className={styles.phaseRow} data-state={state}>
            <span className={styles.phaseDot} aria-hidden="true" />
            {row}
          </li>
        );
      })}
    </ol>
  );
}
