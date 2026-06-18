'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { createFirstProduct, type StepActionState } from './actions';
import styles from './onboarding.module.css';

/**
 * Fresh path step 1 — the first product. On success the chain's Catalog link
 * ignites; we refresh the route so the server re-derives the step machine and
 * advances to the supplier step.
 */
function Submit(): ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending ? 'Adding' : 'Add this product'}
    </ActionButton>
  );
}

export function FirstProductForm(): ReactNode {
  const router = useRouter();
  const [state, formAction] = useActionState<StepActionState, FormData>(createFirstProduct, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.label}>SKU</span>
          <input name="sku" type="text" className={styles.input} placeholder="RBH-1107" required />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Opening quantity on hand</span>
          <input
            name="on_hand"
            type="number"
            min="0"
            step="any"
            className={styles.input}
            placeholder="0"
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Product name</span>
        <input
          name="name"
          type="text"
          className={styles.input}
          placeholder="1/2 in. Galvanized Pipe"
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Unit of measure (optional)</span>
        <input name="unit_of_measure" type="text" className={styles.input} placeholder="each" />
      </label>

      {state?.ok === false ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={styles.submit}>
        <Submit />
      </div>
    </form>
  );
}
