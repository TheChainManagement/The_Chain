'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { createSupplier, type SupplierActionState } from './actions';
import styles from './suppliers.module.css';

/**
 * AddSupplier — the roster's create affordance. Disclosure panel anchored under
 * the header CTA, mirroring AddSku. On success the Server Action has revalidated
 * /suppliers, so we reset + collapse and the new supplier appears in the roster.
 */

function SubmitRow(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Add supplier
    </ActionButton>
  );
}

export function AddSupplier(): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SupplierActionState, FormData>(createSupplier, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  return (
    <div className={styles.addWrap}>
      <ActionButton
        variant={open ? 'secondary' : 'primary'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Cancel' : 'Add supplier'}
      </ActionButton>

      {open ? (
        <form ref={formRef} action={formAction} className={styles.addForm} noValidate>
          <span className={styles.addEyebrow}>New supplier</span>

          <label className={styles.addField}>
            <span className={styles.addLabel}>Supplier name</span>
            <input
              name="name"
              type="text"
              className={styles.addInput}
              placeholder="Atchafalaya Distributing"
              autoComplete="off"
              required
            />
          </label>

          <div className={styles.addRow}>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Email</span>
              <input
                name="email"
                type="email"
                className={styles.addInput}
                placeholder="orders@…"
                autoComplete="off"
              />
            </label>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Phone</span>
              <input
                name="phone"
                type="tel"
                className={styles.addInput}
                placeholder="985-…"
                autoComplete="off"
              />
            </label>
          </div>

          <div className={styles.addRow}>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Lead time (days)</span>
              <input
                name="default_lead_time_days"
                type="text"
                inputMode="numeric"
                className={styles.addInput}
                placeholder="14"
                autoComplete="off"
              />
            </label>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Min order ($)</span>
              <input
                name="min_order_value"
                type="text"
                inputMode="decimal"
                className={styles.addInput}
                placeholder="500"
                autoComplete="off"
              />
            </label>
          </div>

          {state?.ok === false ? (
            <p className={styles.formError} role="alert">
              {state.error}
            </p>
          ) : null}

          <div className={styles.addActions}>
            <SubmitRow />
          </div>
        </form>
      ) : null}
    </div>
  );
}
