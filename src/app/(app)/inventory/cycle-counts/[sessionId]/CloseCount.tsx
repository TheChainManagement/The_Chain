'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import styles from '../../inventory.module.css';
import { type CloseCountState, closeCountSession } from '../actions';

/**
 * CloseCount — the reconciliation trigger. Closing posts every counted line's
 * drift to the stock ledger through the atomic RPC and completes the session;
 * the receipt line reports exactly what the ledger absorbed. Idempotency key
 * minted per mount: a double-click replays as a no-op.
 */

export function CloseCount({ sessionId }: { sessionId: string }): React.ReactNode {
  const router = useRouter();
  const [receipt, setReceipt] = useState<CloseCountState | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  function close(): void {
    startTransition(async () => {
      const result = await closeCountSession({ sessionId, idempotencyKey });
      setReceipt(result);
      if (result.ok) router.refresh();
    });
  }

  if (receipt?.ok) {
    return (
      <p className={styles.countReceipt} role="status">
        Session closed: {receipt.lines} {receipt.lines === 1 ? 'line' : 'lines'} counted,{' '}
        {receipt.movements} {receipt.movements === 1 ? 'variance' : 'variances'} posted to the
        ledger ({receipt.absVariance} units reconciled).
      </p>
    );
  }

  return (
    <div className={styles.countCloseWrap}>
      <ActionButton onClick={close} loading={isPending}>
        Close session &amp; post variances
      </ActionButton>
      {receipt && !receipt.ok ? (
        <span className={styles.formError} role="alert">
          {receipt.error}
        </span>
      ) : null}
    </div>
  );
}
