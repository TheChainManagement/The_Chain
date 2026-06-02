'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { ProductSupplierLink } from '@/lib/inventory/queries';
import type { SupplierOption } from '@/lib/suppliers/queries';
import {
  type LinkActionState,
  linkSupplier,
  setPrimarySupplier,
  unlinkSupplier,
} from '../../suppliers/actions';
import styles from './detail.module.css';

/**
 * SupplierLinks — the product↔supplier bridge on the SKU bench (Block 4). Owns
 * the Suppliers panel: lists linked suppliers with make-primary / unlink, plus a
 * "Link supplier" disclosure (pick supplier + cost / lead time / MOQ / primary →
 * linkSupplier). This is what fills Block 3's previously-empty Suppliers panel.
 */

function LinkSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Link supplier
    </ActionButton>
  );
}

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SupplierLinks({
  productId,
  suppliers,
  options,
}: {
  productId: string;
  suppliers: ProductSupplierLink[];
  options: SupplierOption[];
}): React.ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<LinkActionState, FormData>(linkSupplier, null);
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  // Suppliers already linked can't be linked again — keep them out of the picker.
  const linkedIds = new Set(suppliers.map((s) => s.supplierId));
  const available = options.filter((o) => !linkedIds.has(o.id));

  function runRowAction(
    action: (prev: LinkActionState, fd: FormData) => Promise<LinkActionState>,
    supplierId: string,
  ): void {
    setRowError(null);
    const fd = new FormData();
    fd.set('product_id', productId);
    fd.set('supplier_id', supplierId);
    startTransition(async () => {
      const result = await action(null, fd);
      if (result && !result.ok) {
        setRowError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const canAdd = available.length > 0;

  return (
    <Panel
      prefix="Sources"
      title="Suppliers"
      actions={
        canAdd ? (
          <ActionButton variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Cancel' : 'Link supplier'}
          </ActionButton>
        ) : undefined
      }
    >
      {suppliers.length === 0 && !open ? (
        <p className={styles.supEmpty}>
          {canAdd
            ? 'No suppliers linked. Link one to set cost, lead time, and MOQ for reorder.'
            : 'No suppliers linked. Add a supplier first, then link them here.'}
        </p>
      ) : null}

      {suppliers.length > 0 ? (
        <ul className={styles.supList}>
          {suppliers.map((s) => (
            <li key={s.supplierId} className={styles.supRow}>
              <span className={styles.supName}>
                {s.supplierName ?? 'Unnamed supplier'}
                {s.isPrimary ? <span className={styles.supPrimary}>Primary</span> : null}
              </span>
              <span className={styles.supMeta}>
                <span className={styles.supMetaItem}>
                  <span className={styles.supMetaLabel}>Cost</span>
                  <StatNumber
                    value={s.unitCost == null ? null : fmtMoney(s.unitCost)}
                    unit="$"
                    unitPosition="prefix"
                  />
                </span>
                <span className={styles.supMetaItem}>
                  <span className={styles.supMetaLabel}>Lead</span>
                  <StatNumber value={s.leadTimeDays} unit="days" />
                </span>
                <span className={styles.supMetaItem}>
                  <span className={styles.supMetaLabel}>MOQ</span>
                  <StatNumber value={s.moq} />
                </span>
                <span className={styles.supRowActions}>
                  {!s.isPrimary ? (
                    <button
                      type="button"
                      className={styles.supLinkBtn}
                      disabled={isPending}
                      onClick={() => runRowAction(setPrimarySupplier, s.supplierId)}
                    >
                      Make primary
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.supUnlinkBtn}
                    disabled={isPending}
                    onClick={() => runRowAction(unlinkSupplier, s.supplierId)}
                  >
                    Unlink
                  </button>
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {rowError ? (
        <p className={styles.supError} role="alert">
          {rowError}
        </p>
      ) : null}

      {open ? (
        <form ref={formRef} action={formAction} className={styles.linkForm} noValidate>
          <input type="hidden" name="product_id" value={productId} />
          <label className={styles.linkField}>
            <span className={styles.linkLabel}>Supplier</span>
            <select name="supplier_id" className={styles.linkSelect} required defaultValue="">
              <option value="" disabled>
                Pick a supplier
              </option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.linkRow}>
            <label className={styles.linkField}>
              <span className={styles.linkLabel}>Unit cost ($)</span>
              <input
                name="unit_cost"
                type="text"
                inputMode="decimal"
                className={styles.linkInput}
                placeholder="0.00"
                autoComplete="off"
              />
            </label>
            <label className={styles.linkField}>
              <span className={styles.linkLabel}>Lead (days)</span>
              <input
                name="lead_time_days"
                type="text"
                inputMode="numeric"
                className={styles.linkInput}
                placeholder="14"
                autoComplete="off"
              />
            </label>
            <label className={styles.linkField}>
              <span className={styles.linkLabel}>MOQ</span>
              <input
                name="moq"
                type="text"
                inputMode="numeric"
                className={styles.linkInput}
                placeholder="1"
                autoComplete="off"
              />
            </label>
          </div>

          <label className={styles.linkCheck}>
            <input name="is_primary" type="checkbox" />
            <span>Primary source for this SKU</span>
          </label>

          {state?.ok === false ? (
            <p className={styles.supError} role="alert">
              {state.error}
            </p>
          ) : null}

          <div className={styles.linkActions}>
            <LinkSubmit />
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
