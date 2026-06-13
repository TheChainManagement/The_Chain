'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { PurchaseOrderLine } from '@/lib/purchase-orders/transform';
import { markPurchaseOrderReceived } from './actions';
import styles from './po-detail.module.css';

/**
 * Receive control (Block 10). Records the actual delivery date + the quantity
 * received per line; the action writes the supplier_performance row and rolls
 * up the scorecard, which lights the supplier's reliability ribbon. Open
 * disclosure so the page reads as a record first, an action second.
 */
export function ReceiveControls({
  poId,
  lines,
}: {
  poId: string;
  lines: PurchaseOrderLine[];
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(today());
  // Default each line's receive qty to its outstanding remainder.
  const [qty, setQty] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.lineNo, String(Math.max(0, l.orderedQty - l.receivedQty))]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function receive() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await markPurchaseOrderReceived({
        poId,
        actualDeliveryAt: new Date(date).toISOString(),
        lines: lines.map((l) => ({ lineNo: l.lineNo, receivedQty: Number(qty[l.lineNo] ?? 0) })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(
        res.status === 'received'
          ? `Received in full${res.sampleSize >= 5 ? ' · scorecard now drives lead time' : ''}`
          : 'Partial receipt recorded',
      );
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className={styles.receiveBar}>
        <ActionButton variant="secondary" onClick={() => setOpen(true)}>
          Receive delivery
        </ActionButton>
      </div>
    );
  }

  return (
    <div className={styles.receive} data-testid="receive-controls">
      <div className={styles.receiveHead}>
        <label className={styles.receiveDate}>
          <span className={styles.receiveKey}>DELIVERED ON</span>
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      <div className={styles.receiveLines}>
        {lines.map((l) => {
          const outstanding = Math.max(0, l.orderedQty - l.receivedQty);
          return (
            <div key={l.lineNo} className={styles.receiveLine}>
              <span className={styles.receiveSku}>{l.sku}</span>
              <span className={styles.receiveOutstanding}>
                <StatNumber value={outstanding} /> outstanding
              </span>
              <input
                type="number"
                className={styles.qtyInput}
                min={0}
                max={outstanding}
                value={qty[l.lineNo] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.lineNo]: e.target.value }))}
                aria-label={`Received quantity for ${l.sku}`}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.receiveFoot}>
        {note ? <span className={styles.receiveNote}>{note}</span> : null}
        {error ? (
          <span className={styles.receiveError} role="alert">
            {error}
          </span>
        ) : null}
        <ActionButton variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </ActionButton>
        <ActionButton variant="primary" onClick={receive} loading={pending}>
          Confirm receipt
        </ActionButton>
      </div>
    </div>
  );
}

function today(): string {
  // Local YYYY-MM-DD for the date input's max + default.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
