'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { SupplierStatus } from '@/lib/suppliers/transform';
import { archiveSupplier, type SupplierActionState, updateSupplier } from '../actions';
import formStyles from '../suppliers.module.css';
import styles from './detail.module.css';

/**
 * SupplierActions — edit + archive in the supplier detail header. Mirrors
 * SkuActions. Archive is a soft status flip behind an inline confirm; the server
 * guard rejects archiving a supplier with open POs and names them, surfaced here.
 */

function EditSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Save changes
    </ActionButton>
  );
}

function ArchiveSubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" variant="secondary" loading={pending}>
      Archive supplier
    </ActionButton>
  );
}

export function SupplierActions({
  supplierId,
  name,
  email,
  phone,
  defaultLeadTimeDays,
  minOrderValue,
  status,
}: {
  supplierId: string;
  name: string;
  email: string;
  phone: string;
  defaultLeadTimeDays: number | null;
  minOrderValue: number | null;
  status: SupplierStatus;
}): React.ReactNode {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirmArchive'>('idle');
  const [editState, editAction] = useActionState<SupplierActionState, FormData>(
    updateSupplier,
    null,
  );
  const [archiveState, archiveAction] = useActionState<SupplierActionState, FormData>(
    archiveSupplier,
    null,
  );
  const editRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editState?.ok) {
      setMode('idle');
    }
  }, [editState]);
  useEffect(() => {
    if (archiveState?.ok) {
      setMode('idle');
    }
  }, [archiveState]);

  const active = status === 'active';

  return (
    <div className={styles.actionsWrap}>
      <div className={styles.actionsRow}>
        <span className={`${styles.statusBadge} ${active ? styles.statusOn : styles.statusOff}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {active ? 'Active' : 'Archived'}
        </span>

        <ActionButton
          variant="secondary"
          onClick={() => setMode((m) => (m === 'edit' ? 'idle' : 'edit'))}
          aria-expanded={mode === 'edit'}
        >
          {mode === 'edit' ? 'Cancel' : 'Edit'}
        </ActionButton>

        {active ? (
          mode === 'confirmArchive' ? (
            <form action={archiveAction} className={styles.confirmForm}>
              <input type="hidden" name="supplier_id" value={supplierId} />
              <span className={styles.confirmText}>Archive?</span>
              <ArchiveSubmit />
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setMode('idle')}
              >
                Keep
              </button>
            </form>
          ) : (
            <ActionButton variant="secondary" onClick={() => setMode('confirmArchive')}>
              Archive
            </ActionButton>
          )
        ) : null}
      </div>

      {mode === 'confirmArchive' && archiveState?.ok === false ? (
        <p className={`${formStyles.formError} ${styles.archiveError}`} role="alert">
          {archiveState.error}
        </p>
      ) : null}

      {mode === 'edit' ? (
        <form ref={editRef} action={editAction} className={formStyles.addForm} noValidate>
          <input type="hidden" name="supplier_id" value={supplierId} />
          <span className={formStyles.addEyebrow}>Edit supplier</span>

          <label className={formStyles.addField}>
            <span className={formStyles.addLabel}>Supplier name</span>
            <input
              name="name"
              type="text"
              className={formStyles.addInput}
              defaultValue={name}
              autoComplete="off"
              required
            />
          </label>

          <div className={formStyles.addRow}>
            <label className={formStyles.addField}>
              <span className={formStyles.addLabel}>Email</span>
              <input
                name="email"
                type="email"
                className={formStyles.addInput}
                defaultValue={email}
                autoComplete="off"
              />
            </label>
            <label className={formStyles.addField}>
              <span className={formStyles.addLabel}>Phone</span>
              <input
                name="phone"
                type="tel"
                className={formStyles.addInput}
                defaultValue={phone}
                autoComplete="off"
              />
            </label>
          </div>

          <div className={formStyles.addRow}>
            <label className={formStyles.addField}>
              <span className={formStyles.addLabel}>Lead time (days)</span>
              <input
                name="default_lead_time_days"
                type="text"
                inputMode="numeric"
                className={formStyles.addInput}
                defaultValue={defaultLeadTimeDays ?? ''}
                autoComplete="off"
              />
            </label>
            <label className={formStyles.addField}>
              <span className={formStyles.addLabel}>Min order ($)</span>
              <input
                name="min_order_value"
                type="text"
                inputMode="decimal"
                className={formStyles.addInput}
                defaultValue={minOrderValue ?? ''}
                autoComplete="off"
              />
            </label>
          </div>

          {editState?.ok === false ? (
            <p className={formStyles.formError} role="alert">
              {editState.error}
            </p>
          ) : null}

          <div className={formStyles.addActions}>
            <EditSubmit />
          </div>
        </form>
      ) : null}
    </div>
  );
}
