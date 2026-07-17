'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { DirectRequisitionOption, RequisitionDetail } from '@/lib/procurement/queries';
import { canDecideRequisition } from '@/lib/procurement/transform';
import {
  approveRequisition,
  cancelRequisition,
  convertRequisition,
  type RfqEditState,
  rejectRequisition,
  saveRequisitionLine,
  submitRequisition,
  updateSupplierLinkPrice,
} from '../../actions';
import styles from './requisition.module.css';

/**
 * RequisitionWorkbench (W2-3 slice 4) — the approval document's actions.
 * Draft/rejected: Submit (+ Cancel). Submitted: Approve / Reject (with a
 * required note) for owner+manager who are NOT the requester (design §7.1);
 * the self-approval gate is enforced server-side and mirrored here so the
 * requester sees WHY the buttons are missing. Approved: Convert to POs (the
 * W2-3d RPC; one PO per vendor). Lines carry the post-award "update link
 * price" affordance (design §8) — explicit and audited, never automatic.
 */

export function RequisitionActions({
  requisition,
  viewer,
}: {
  requisition: RequisitionDetail;
  viewer: { userId: string | null; role: string };
}): React.ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const decision = canDecideRequisition({
    status: requisition.status,
    role: viewer.role,
    actorUserId: viewer.userId,
    requestedByUserId: requisition.requestedByUserId,
  });

  function run(action: () => Promise<RfqEditState>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      setRejecting(false);
      setRejectNote('');
      router.refresh();
    });
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const res = await convertRequisition({ requisitionId: requisition.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const status = requisition.status;

  if (!requisition.isCurrentVersion) {
    return <span className={styles.poMeta}>Superseded award · read only</span>;
  }

  return (
    <div className={styles.headerActions}>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}

      {status === 'draft' || status === 'rejected' ? (
        <>
          <ActionButton
            variant="secondary"
            onClick={() => run(() => cancelRequisition({ requisitionId: requisition.id }))}
            loading={pending}
          >
            Cancel
          </ActionButton>
          <ActionButton
            onClick={() => run(() => submitRequisition({ requisitionId: requisition.id }))}
            loading={pending}
          >
            {status === 'rejected' ? 'Resubmit for approval' : 'Submit for approval'}
          </ActionButton>
        </>
      ) : null}

      {status === 'submitted' ? (
        decision.ok ? (
          <>
            {rejecting ? (
              <span className={styles.rejectForm}>
                <input
                  type="text"
                  className={styles.rejectInput}
                  placeholder="Why is this coming back?"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  aria-label="Rejection note"
                />
                <ActionButton
                  variant="secondary"
                  onClick={() =>
                    run(() =>
                      rejectRequisition({ requisitionId: requisition.id, note: rejectNote }),
                    )
                  }
                  loading={pending}
                >
                  Reject
                </ActionButton>
              </span>
            ) : (
              <ActionButton variant="secondary" onClick={() => setRejecting(true)}>
                Reject…
              </ActionButton>
            )}
            <ActionButton
              onClick={() => run(() => approveRequisition({ requisitionId: requisition.id }))}
              loading={pending}
            >
              Approve
            </ActionButton>
          </>
        ) : (
          <span className={styles.poMeta}>{decision.ok === false ? decision.error : null}</span>
        )
      ) : null}

      {status === 'approved' ? (
        <ActionButton onClick={convert} loading={pending}>
          Convert to purchase orders
        </ActionButton>
      ) : null}
    </div>
  );
}

export function RequisitionLines({
  requisition,
  options = [],
}: {
  requisition: RequisitionDetail;
  options?: DirectRequisitionOption[];
}): React.ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const editable =
    requisition.isCurrentVersion &&
    (requisition.status === 'draft' || requisition.status === 'rejected');

  function updateLink(lineNo: number) {
    setError(null);
    startTransition(async () => {
      const res = await updateSupplierLinkPrice({ requisitionId: requisition.id, lineNo });
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.lines} data-testid="requisition-lines">
      <div className={styles.linesHead} aria-hidden="true">
        <span>#</span>
        <span>SKU</span>
        <span>Vendor</span>
        <span className={styles.num}>Qty</span>
        <span className={styles.num}>Unit cost</span>
        <span className={styles.num}>Line total</span>
        <span>Link</span>
      </div>

      {editable ? (
        <div className={styles.editBar}>
          <span>Draft lines can be changed. Saving an awarded line clears its quote snapshot.</span>
          <button type="button" className={styles.linkBtn} onClick={() => setEditing('new')}>
            Add line
          </button>
        </div>
      ) : null}

      {editing === 'new' ? (
        <LineEditor
          requisitionId={requisition.id}
          lineNo={null}
          options={options}
          pending={pending}
          onCancel={() => setEditing(null)}
          onError={setError}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          startTransition={startTransition}
        />
      ) : null}

      {requisition.lines.map((line) => {
        const lineTotal = line.unitCost == null ? null : line.unitCost * line.qty;
        const linkCurrent =
          line.unitCost != null &&
          line.linkUnitCost != null &&
          line.linkUnitCost === line.unitCost &&
          line.linkPurchaseUom === line.purchaseUom &&
          line.linkFactor === line.factor;
        return editing === line.lineNo ? (
          <LineEditor
            key={line.lineNo}
            requisitionId={requisition.id}
            lineNo={line.lineNo}
            initialPair={`${line.productId}:${line.supplierId}`}
            initialQty={line.qty}
            initialCost={line.unitCost ?? 0}
            options={options}
            pending={pending}
            onCancel={() => setEditing(null)}
            onError={setError}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
            startTransition={startTransition}
          />
        ) : (
          <div key={line.lineNo} className={styles.lineRow}>
            <span className={styles.lineNo}>{line.lineNo}</span>
            <span className={styles.lineSku}>
              <span className={styles.lineSkuCode}>{line.sku}</span>
              <span className={styles.lineName}>{line.productName}</span>
            </span>
            <span className={styles.lineName}>{line.supplierName}</span>
            <span className={styles.num}>
              <StatNumber value={line.qty} unit={line.purchaseUom ?? undefined} />
            </span>
            <span className={styles.num}>
              <StatNumber value={line.unitCost == null ? null : `$${line.unitCost.toFixed(2)}`} />
            </span>
            <span className={styles.num}>
              <StatNumber value={lineTotal == null ? null : `$${lineTotal.toFixed(2)}`} />
            </span>
            {editable ? (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setEditing(line.lineNo)}
              >
                Edit line
              </button>
            ) : line.unitCost == null || !requisition.isCurrentVersion ? (
              <span />
            ) : linkCurrent ? (
              <span className={styles.linkDone}>Link current</span>
            ) : (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => updateLink(line.lineNo)}
                disabled={pending}
                title={
                  line.linkUnitCost == null
                    ? 'Copy the awarded price onto the supplier link'
                    : `Supplier link has $${line.linkUnitCost.toFixed(2)} on file`
                }
              >
                Update link price
              </button>
            )}
          </div>
        );
      })}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LineEditor({
  requisitionId,
  lineNo,
  options,
  initialPair = '',
  initialQty = 1,
  initialCost = 0,
  pending,
  onCancel,
  onError,
  onSaved,
  startTransition,
}: {
  requisitionId: string;
  lineNo: number | null;
  options: DirectRequisitionOption[];
  initialPair?: string;
  initialQty?: number;
  initialCost?: number;
  pending: boolean;
  onCancel: () => void;
  onError: (error: string | null) => void;
  onSaved: () => void;
  startTransition: React.TransitionStartFunction;
}): React.ReactNode {
  const [pair, setPair] = useState(
    initialPair || `${options[0]?.productId}:${options[0]?.supplierId}`,
  );
  const [qty, setQty] = useState(String(initialQty));
  const [cost, setCost] = useState(String(initialCost));

  function save() {
    const [productId = '', supplierId = ''] = pair.split(':');
    onError(null);
    startTransition(async () => {
      const res = await saveRequisitionLine({
        requisitionId,
        lineNo,
        productId,
        supplierId,
        qty: Number(qty),
        unitCost: Number(cost),
      });
      if (res && !res.ok) {
        onError(res.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className={styles.lineEditor} data-testid="requisition-line-editor">
      <select value={pair} onChange={(event) => setPair(event.target.value)} disabled={pending}>
        {options.map((option) => (
          <option
            key={`${option.productId}:${option.supplierId}`}
            value={`${option.productId}:${option.supplierId}`}
          >
            {option.sku} · {option.supplierName}
          </option>
        ))}
      </select>
      <input
        aria-label="Purchase quantity"
        type="number"
        min="0.01"
        step="0.01"
        value={qty}
        onChange={(event) => setQty(event.target.value)}
        disabled={pending}
      />
      <input
        aria-label="Unit cost"
        type="number"
        min="0"
        step="0.01"
        value={cost}
        onChange={(event) => setCost(event.target.value)}
        disabled={pending}
      />
      <div className={styles.editorActions}>
        <button type="button" className={styles.linkBtn} onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <ActionButton onClick={save} loading={pending}>
          Save line
        </ActionButton>
      </div>
    </div>
  );
}
