import type { ReactNode } from 'react';
import {
  buildRequisitionChain,
  buildRfqChain,
  type RequisitionStatus,
  type RfqStatus,
} from '@/lib/procurement/transform';
import styles from './procurement.module.css';

/**
 * RfqChainTrack — the compact RFQ status chain (DRAFTED · SENT · QUOTED ·
 * CLOSED), reached nodes lit cobalt, a canceled document showing a stop node
 * where it died. Same at-a-glance language as the PO OrderTrack; the stage
 * logic is pure (buildRfqChain).
 */
export function RfqChainTrack({ status }: { status: RfqStatus }): ReactNode {
  const steps = buildRfqChain(status);
  const done = steps.filter((s) => s.state === 'done').length;
  const label =
    status === 'canceled'
      ? 'Quote request canceled'
      : `Quote request progress: ${done} of ${steps.length} steps`;

  return (
    <span className={styles.chain} role="img" aria-label={label}>
      {steps.map((s, i) => (
        <span key={s.step} className={styles.chainSeg}>
          <span className={styles.chainNode} data-state={s.state} title={s.step} />
          {i < steps.length - 1 ? (
            <span className={styles.chainLink} data-state={s.state} aria-hidden="true" />
          ) : null}
        </span>
      ))}
    </span>
  );
}

/**
 * RequisitionChainTrack — DRAFTED · SUBMITTED · APPROVED · ORDERED. A rejected
 * document shows the stop node AT the decision point; canceled where it died.
 */
export function RequisitionChainTrack({ status }: { status: RequisitionStatus }): ReactNode {
  const steps = buildRequisitionChain(status);
  const done = steps.filter((s) => s.state === 'done').length;
  const label =
    status === 'rejected'
      ? 'Requisition rejected'
      : status === 'canceled'
        ? 'Requisition canceled'
        : `Requisition progress: ${done} of ${steps.length} steps`;

  return (
    <span className={styles.chain} role="img" aria-label={label}>
      {steps.map((s, i) => (
        <span key={s.step} className={styles.chainSeg}>
          <span className={styles.chainNode} data-state={s.state} title={s.step} />
          {i < steps.length - 1 ? (
            <span className={styles.chainLink} data-state={s.state} aria-hidden="true" />
          ) : null}
        </span>
      ))}
    </span>
  );
}
