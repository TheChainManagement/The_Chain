'use client';

import { useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { InventoryListRow } from '@/lib/inventory/queries';
import {
  ADJUSTMENT_REASONS,
  DEMAND_REF_TYPES,
  type DemandRefType,
  ISSUE_REASONS,
} from '@/lib/storeroom/constants';
import styles from './inventory.module.css';
import { adjustStock, issueStock } from './storeroom-actions';

/**
 * OperatorPanel (W2-2) — the issue-out / adjustment surface that opens under
 * the ledger's bulk bar. One consuming object per issue event, N lines (a kit
 * = N rows sharing the demand ref, per the mode-spine §10 shape). Each line
 * shows on hand → after, so the operator watches the storeroom drain before
 * committing. The idempotency key is minted when the panel opens: a re-click
 * replays the same key and the RPC makes it a no-op.
 */

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export type OperatorMode = 'issue' | 'adjust';

export function OperatorPanel({
  mode,
  rows,
  onDone,
  onCancel,
}: {
  mode: OperatorMode;
  rows: InventoryListRow[];
  onDone: () => void;
  onCancel: () => void;
}): React.ReactNode {
  return mode === 'issue' ? (
    <IssueForm rows={rows} onDone={onDone} onCancel={onCancel} />
  ) : (
    <AdjustForm row={rows[0]} onDone={onDone} onCancel={onCancel} />
  );
}

function IssueForm({
  rows,
  onDone,
  onCancel,
}: {
  rows: InventoryListRow[];
  onDone: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const [refType, setRefType] = useState<DemandRefType>('work_order');
  const [refId, setRefId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // One key per panel-open: a double-submit replays as a no-op in the RPC.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const refMeta = DEMAND_REF_TYPES.find((t) => t.value === refType) ?? DEMAND_REF_TYPES[0];

  function lineQty(id: string): number {
    const n = Number(qty[id] ?? '');
    return Number.isFinite(n) ? n : 0;
  }

  function submit(): void {
    setError(null);
    if (!refId.trim()) {
      setError('Enter the reference the material is issued to.');
      return;
    }
    const lines = rows
      .map((r) => ({ productId: r.id, qty: lineQty(r.id) }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) {
      setError('Enter a quantity on at least one line.');
      return;
    }
    startTransition(async () => {
      const result = await issueStock({
        movement: 'issue_out',
        demandRefType: refType,
        demandRefId: refId.trim(),
        reasonCode: reason || undefined,
        note: note.trim() || undefined,
        lines,
        idempotencyKey,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <section className={styles.opPanel} aria-label="Issue material out">
      <span className={styles.addEyebrow}>
        Issue out · {rows.length} {rows.length === 1 ? 'item' : 'items'}
      </span>

      <div className={styles.opShared}>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Issued to</span>
          <select
            className={styles.addInput}
            value={refType}
            onChange={(e) => setRefType(e.target.value as DemandRefType)}
          >
            {DEMAND_REF_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>{refMeta.label} reference</span>
          <input
            type="text"
            className={styles.addInput}
            value={refId}
            onChange={(e) => setRefId(e.target.value)}
            placeholder={refMeta.placeholder}
            autoComplete="off"
          />
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Reason</span>
          <select
            className={styles.addInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Optional</option>
            {ISSUE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Note</span>
          <input
            type="text"
            className={styles.addInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>
      </div>

      <div className={styles.opLines}>
        <div className={styles.opLineHead} aria-hidden="true">
          <span>SKU</span>
          <span>Product</span>
          <span className={styles.opNum}>On hand</span>
          <span className={styles.opNum}>Issue qty</span>
          <span className={styles.opNum}>After</span>
        </div>
        {rows.map((r) => {
          const q = lineQty(r.id);
          const after = r.onHand - q;
          return (
            <div key={r.id} className={styles.opLine}>
              <span className={styles.opSku}>{r.sku}</span>
              <span className={styles.opName}>{r.name}</span>
              <span className={styles.opNum}>{fmtQty(r.onHand)}</span>
              <span className={styles.opNum}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={`${styles.addInput} ${styles.opQtyInput}`}
                  value={qty[r.id] ?? ''}
                  onChange={(e) => setQty((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  aria-label={`Quantity to issue for ${r.sku}`}
                  placeholder="0"
                />
              </span>
              <span className={`${styles.opNum} ${q > 0 ? styles.opAfterLive : styles.opAfter}`}>
                {q > 0 ? fmtQty(after) : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.opActions}>
        <ActionButton variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </ActionButton>
        <ActionButton onClick={submit} loading={isPending}>
          Issue material
        </ActionButton>
      </div>
    </section>
  );
}

function AdjustForm({
  row,
  onDone,
  onCancel,
}: {
  row: InventoryListRow | undefined;
  onDone: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  if (!row) return null;
  const d = Number(delta);
  const valid = Number.isFinite(d) && d !== 0;

  function submit(): void {
    if (!row) return;
    setError(null);
    if (!valid) {
      setError('Enter a non-zero adjustment (negative removes stock).');
      return;
    }
    if (!reason) {
      setError('Pick a reason for the adjustment.');
      return;
    }
    startTransition(async () => {
      const result = await adjustStock({
        productId: row.id,
        delta: d,
        reasonCode: reason,
        note: note.trim() || undefined,
        idempotencyKey,
      });
      if (!result.ok) {
        setError(result.error);
      } else {
        onDone();
      }
    });
  }

  return (
    <section className={styles.opPanel} aria-label="Adjust stock">
      <span className={styles.addEyebrow}>
        Adjust · {row.sku} — {row.name}
      </span>

      <div className={styles.opShared}>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Adjustment (±)</span>
          <input
            type="number"
            step="any"
            className={styles.addInput}
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="-3 or 12"
            autoComplete="off"
          />
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Reason</span>
          <select
            className={styles.addInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Pick one</option>
            {ADJUSTMENT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Note</span>
          <input
            type="text"
            className={styles.addInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>
        <div className={styles.addField}>
          <span className={styles.addLabel}>On hand → after</span>
          <span className={styles.opPreview}>
            {fmtQty(row.onHand)} → {valid ? fmtQty(row.onHand + d) : '—'}
          </span>
        </div>
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.opActions}>
        <ActionButton variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </ActionButton>
        <ActionButton onClick={submit} loading={isPending}>
          Apply adjustment
        </ActionButton>
      </div>
    </section>
  );
}
