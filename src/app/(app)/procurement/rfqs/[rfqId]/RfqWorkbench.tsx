'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { RfqDetail, SkuOption } from '@/lib/procurement/queries';
import { canEditDocument, canSend } from '@/lib/procurement/transform';
import type { SupplierOption } from '@/lib/suppliers/queries';
import {
  addRfqLine,
  addRfqVendor,
  cancelRfq,
  closeRfq,
  type RfqEditState,
  removeRfqLine,
  removeRfqVendor,
  sendRfq,
} from '../../actions';
import styles from './rfq.module.css';

/**
 * RfqWorkbench — the RFQ detail's working surfaces (W2-3 slice 2). A draft is
 * editable: add/remove lines (count-sheet SKU datalist idiom) and vendors.
 * Send locks the document, stamps every vendor plate, and flips the per-vendor
 * export documents (CSV + print sheet) live — the export-for-manual-send
 * decision (design §7.2). Close/cancel settle it.
 */

export function RfqStatusActions({ rfq }: { rfq: RfqDetail }): React.ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sendable = canSend(rfq.status, rfq.lines.length, rfq.vendors.length);

  function run(action: () => Promise<RfqEditState>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.headerActions}>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      {rfq.status === 'draft' ? (
        <>
          <ActionButton
            variant="secondary"
            onClick={() => run(() => cancelRfq({ rfqId: rfq.id }))}
            loading={pending}
          >
            Cancel request
          </ActionButton>
          <ActionButton
            onClick={() => run(() => sendRfq({ rfqId: rfq.id }))}
            loading={pending}
            disabled={!sendable.ok}
            title={sendable.ok ? undefined : sendable.error}
          >
            Mark sent
          </ActionButton>
        </>
      ) : null}
      {rfq.status === 'sent' || rfq.status === 'quoted' ? (
        <ActionButton
          variant="secondary"
          onClick={() => run(() => closeRfq({ rfqId: rfq.id }))}
          loading={pending}
        >
          Close request
        </ActionButton>
      ) : null}
    </div>
  );
}

function AddLineSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending} variant="secondary">
      Add line
    </ActionButton>
  );
}

export function RfqLines({
  rfq,
  skuOptions,
}: {
  rfq: RfqDetail;
  skuOptions: SkuOption[];
}): React.ReactNode {
  const editable = canEditDocument(rfq.status).ok;
  const [state, formAction] = useActionState<RfqEditState, FormData>(addRfqLine, null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      skuRef.current?.focus();
    }
  }, [state]);

  function remove(lineNo: number) {
    setRemoveError(null);
    startTransition(async () => {
      const res = await removeRfqLine({ rfqId: rfq.id, lineNo });
      if (res && !res.ok) {
        setRemoveError(res.error);
      }
    });
  }

  return (
    <div className={styles.lines} data-testid="rfq-lines">
      <div className={styles.linesHead} aria-hidden="true">
        <span>#</span>
        <span>SKU</span>
        <span>Note</span>
        <span style={{ textAlign: 'right' }}>Qty</span>
        <span />
      </div>

      {rfq.lines.map((line) => (
        <div key={line.lineNo} className={styles.lineRow}>
          <span className={styles.lineNo}>{line.lineNo}</span>
          <span className={styles.lineSku}>
            <span className={styles.lineSkuCode}>{line.sku}</span>
            <span className={styles.lineName}>{line.productName}</span>
          </span>
          <span className={styles.lineName}>{line.note ?? ''}</span>
          <span className={styles.lineQty}>
            <StatNumber value={line.qty} unit={line.stockUom ?? undefined} />
          </span>
          {editable ? (
            <button
              type="button"
              className={styles.lineRemove}
              onClick={() => remove(line.lineNo)}
              aria-label={`Remove line ${line.lineNo} (${line.sku})`}
            >
              ×
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      {removeError ? (
        <p className={styles.error} role="alert">
          {removeError}
        </p>
      ) : null}

      {editable ? (
        <form ref={formRef} action={formAction} className={styles.addLine} noValidate>
          <input type="hidden" name="rfq_id" value={rfq.id} />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>SKU</span>
            <input
              ref={skuRef}
              name="sku"
              type="text"
              className={styles.input}
              placeholder="Type to search the catalog"
              autoComplete="off"
              list="rfq-sku-options"
              required
            />
            <datalist id="rfq-sku-options">
              {skuOptions.map((o) => (
                <option key={o.sku} value={o.sku}>
                  {o.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Qty</span>
            <input
              name="qty"
              type="number"
              min="0.01"
              step="any"
              className={styles.input}
              autoComplete="off"
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Note</span>
            <input name="note" type="text" className={styles.input} autoComplete="off" />
          </label>
          <AddLineSubmit />
          {state?.ok === false ? (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

const VENDOR_STATUS_LABEL: Record<RfqDetail['vendors'][number]['status'], string> = {
  pending: 'Awaiting quote',
  quoted: 'Quoted',
  declined: 'Declined',
};

export function RfqVendors({
  rfq,
  supplierOptions,
}: {
  rfq: RfqDetail;
  supplierOptions: SupplierOption[];
}): React.ReactNode {
  const editable = canEditDocument(rfq.status).ok;
  const documentsLive = rfq.status !== 'draft' && rfq.status !== 'canceled';
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectRef = useRef<HTMLSelectElement>(null);

  const onBench = new Set(rfq.vendors.map((v) => v.supplierId));
  const addable = supplierOptions.filter((s) => !onBench.has(s.id));

  function add() {
    const supplierId = selectRef.current?.value;
    if (!supplierId) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addRfqVendor({ rfqId: rfq.id, supplierId });
      if (res && !res.ok) {
        setError(res.error);
      }
    });
  }

  function remove(supplierId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeRfqVendor({ rfqId: rfq.id, supplierId });
      if (res && !res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className={styles.vendors} data-testid="rfq-vendors">
      <div className={styles.vendorsHead}>
        <span>Vendors</span>
        <span>
          {rfq.vendors.length === 1 ? '1 on this request' : `${rfq.vendors.length} on this request`}
        </span>
      </div>

      {rfq.vendors.map((v) => (
        <div key={v.supplierId} className={styles.vendorRow}>
          <span>
            <span className={styles.vendorName}>{v.supplierName}</span>{' '}
            <span className={styles.vendorStatus}>{VENDOR_STATUS_LABEL[v.status]}</span>
          </span>
          <span className={styles.vendorDocs}>
            {documentsLive ? (
              <>
                <a
                  className={styles.vendorDoc}
                  href={`/api/exports/procurement/rfq/${rfq.id}/${v.supplierId}`}
                >
                  CSV ↓
                </a>
                <a
                  className={styles.vendorDoc}
                  href={`/print/rfq/${rfq.id}/${v.supplierId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Print sheet
                </a>
              </>
            ) : null}
            {editable ? (
              <button
                type="button"
                className={styles.lineRemove}
                onClick={() => remove(v.supplierId)}
                aria-label={`Remove ${v.supplierName}`}
              >
                ×
              </button>
            ) : null}
          </span>
        </div>
      ))}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {editable && addable.length > 0 ? (
        <div className={styles.addVendor}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Add vendor</span>
            <select ref={selectRef} className={styles.select} defaultValue={addable[0]?.id}>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <ActionButton variant="secondary" onClick={add} loading={pending}>
            Add
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
