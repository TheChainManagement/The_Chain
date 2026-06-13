'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { approvePurchaseOrder } from './actions';
import styles from './po-detail.module.css';

/**
 * Approve control (Block 11b). A draft purchase order is committed here: the
 * action writes it back to QuickBooks (or marks it for manual send) and
 * advances the chain — the page refresh floods cobalt into the IN TRANSIT link.
 * The order is now live and the receive control takes over.
 */
export function ApproveControls({ poId }: { poId: string }): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approvePurchaseOrder({ poId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.receiveBar} data-testid="approve-controls">
      <div className={styles.approveCopy}>
        <span className={styles.approveLead}>Ready to place</span>
        <span className={styles.approveSub}>
          Approving places the order — written back to QuickBooks when connected, otherwise ready to
          export and send — and commits the quantity as in-transit stock.
        </span>
      </div>
      {error ? (
        <span className={styles.receiveError} role="alert">
          {error}
        </span>
      ) : null}
      <ActionButton variant="primary" onClick={approve} loading={pending}>
        Approve order
      </ActionButton>
    </div>
  );
}
