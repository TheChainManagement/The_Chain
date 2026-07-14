'use client';

import { useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { TransferRecommendation } from '@/lib/transfers/recommend';
import { executeTransfer } from './actions';
import styles from './transfers.module.css';

export function TransferAction({ recommendation }: { recommendation: TransferRecommendation }) {
  const [quantity, setQuantity] = useState(String(recommendation.suggestedQty));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  function submit() {
    setError(null);
    const qty = Number(quantity);
    startTransition(async () => {
      const result = await executeTransfer({
        productId: recommendation.productId,
        sourceLocationId: recommendation.sourceLocationId,
        destinationLocationId: recommendation.destinationLocationId,
        quantity: qty,
        idempotencyKey,
      });
      if (!result.ok) setError(result.error);
      else setPosted(true);
    });
  }

  return (
    <div className={styles.action}>
      <label>
        <span>Move qty</span>
        <input
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          disabled={pending || posted}
        />
      </label>
      <ActionButton onClick={submit} loading={pending} disabled={posted}>
        {posted ? 'Transferred' : 'Move stock'}
      </ActionButton>
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}
