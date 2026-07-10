'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { PurchaseOrderLine } from '@/lib/purchase-orders/transform';
import { markPurchaseOrderReceived } from './actions';
import styles from './po-detail.module.css';

/**
 * Receive control (Block 10; W2-2.5 conversion rail). Records the actual
 * delivery date + the quantity received per line IN PURCHASE UoM; the action
 * writes the supplier_performance row and rolls up the scorecard. Lines with a
 * purchase→stock factor show the live conversion rail (× factor → stock units)
 * that lights as the operator types; a non-whole stock result raises the
 * FRACTIONAL tag (MG 2026-07-09: fractional is allowed, flagged, never
 * rounded). Open disclosure so the page reads as a record first.
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
  // One stable key per submission attempt: a double-click reuses it (the RPC
  // dedupes and won't double-count stock), while a deliberate second receipt
  // (partial → the rest) rotates to a fresh key after the first one applies.
  const [submitKey, setSubmitKey] = useState(() => crypto.randomUUID());

  function receive() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await markPurchaseOrderReceived({
        poId,
        actualDeliveryAt: new Date(date).toISOString(),
        lines: lines.map((l) => ({ lineNo: l.lineNo, receivedQty: Number(qty[l.lineNo] ?? 0) })),
        idempotencyKey: submitKey,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSubmitKey(crypto.randomUUID());
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
          const factor = l.purchaseToStockFactor;
          const entered = Number(qty[l.lineNo] ?? 0);
          const stockQty = factor == null ? null : entered * factor;
          // MG decision 2026-07-09: fractional stock is allowed — the rail
          // flags a remainder, it never blocks or rounds.
          const fractional = stockQty != null && Number.isFinite(stockQty) && stockQty % 1 !== 0;
          return (
            <div key={l.lineNo} className={styles.receiveLine}>
              <span className={styles.receiveSku}>{l.sku}</span>
              <span className={styles.receiveOutstanding}>
                <StatNumber value={outstanding} unit={l.purchaseUom ?? undefined} /> outstanding
              </span>
              <input
                type="number"
                className={styles.qtyInput}
                min={0}
                max={outstanding}
                value={qty[l.lineNo] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.lineNo]: e.target.value }))}
                aria-label={`Received quantity for ${l.sku}${l.purchaseUom ? ` in ${l.purchaseUom}` : ''}`}
              />
              {factor != null && stockQty != null && Number.isFinite(stockQty) ? (
                <span
                  role="status"
                  className={styles.convRail}
                  data-live={entered > 0 || undefined}
                  aria-label={`Converts to ${fmtQty(stockQty)} ${l.stockUom ?? 'stock units'}`}
                >
                  × {fmtQty(factor)} → <StatNumber value={fmtQty(stockQty)} />{' '}
                  {l.stockUom ?? 'stock units'}
                  {fractional ? <span className={styles.convFraction}>fractional</span> : null}
                </span>
              ) : null}
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

/** Trim trailing zeros: 12 → "12", 2.50 → "2.5", 0.4536 → "0.4536". */
function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function today(): string {
  // Local YYYY-MM-DD for the date input's max + default.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
