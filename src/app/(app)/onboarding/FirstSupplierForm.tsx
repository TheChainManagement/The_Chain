'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { createFirstSupplier, type StepActionState } from './actions';
import styles from './onboarding.module.css';

/**
 * Fresh path step 2 — the first supplier, linked as the primary source of the
 * first product. On success the Suppliers link ignites and the chain advances to
 * the forecast step.
 */
function Submit(): ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending ? 'Adding' : 'Add this supplier'}
    </ActionButton>
  );
}

export function FirstSupplierForm(): ReactNode {
  const router = useRouter();
  const [state, formAction] = useActionState<StepActionState, FormData>(createFirstSupplier, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className={styles.form} noValidate>
      <label className={styles.field}>
        <span className={styles.label}>Supplier name</span>
        <input
          name="name"
          type="text"
          className={styles.input}
          placeholder="Atchafalaya Distributing"
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Typical lead time in days (optional)</span>
        <input
          name="default_lead_time_days"
          type="number"
          min="0"
          step="1"
          className={styles.input}
          placeholder="7"
        />
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
