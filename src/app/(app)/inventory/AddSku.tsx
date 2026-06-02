'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { createProduct, type ProductActionState } from './actions';
import styles from './inventory.module.css';

/**
 * AddSku — the catalog's create affordance. A disclosure panel anchored under the
 * header CTA. Client island: owns open/close + the useActionState error channel.
 * On success the Server Action has already revalidated /inventory, so we just
 * reset the form and collapse; the new SKU appears in the ledger.
 */

function SubmitRow(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Add to catalog
    </ActionButton>
  );
}

export function AddSku(): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ProductActionState, FormData>(createProduct, null);
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
        {open ? 'Cancel' : 'Add SKU'}
      </ActionButton>

      {open ? (
        <form ref={formRef} action={formAction} className={styles.addForm} noValidate>
          <span className={styles.addEyebrow}>New SKU</span>

          <label className={styles.addField}>
            <span className={styles.addLabel}>SKU</span>
            <input
              name="sku"
              type="text"
              className={styles.addInput}
              placeholder="RBH-4471"
              autoComplete="off"
              required
            />
          </label>

          <label className={styles.addField}>
            <span className={styles.addLabel}>Product name</span>
            <input
              name="name"
              type="text"
              className={styles.addInput}
              placeholder="3/4 in. galvanized elbow"
              autoComplete="off"
              required
            />
          </label>

          <label className={styles.addField}>
            <span className={styles.addLabel}>Unit of measure</span>
            <input
              name="unit_of_measure"
              type="text"
              className={styles.addInput}
              placeholder="each"
              autoComplete="off"
            />
          </label>

          <label className={styles.addField}>
            <span className={styles.addLabel}>Description</span>
            <input
              name="description"
              type="text"
              className={styles.addInput}
              placeholder="Optional"
              autoComplete="off"
            />
          </label>

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
