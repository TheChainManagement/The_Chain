'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import styles from '../../inventory.module.css';
import { type CountLineState, saveCountLine } from '../actions';

/**
 * CountEntry — the count sheet's input row: SKU + counted quantity, enter,
 * next. On save the Server Action revalidates the session page, the line
 * appears in the sheet below, and the form resets to the SKU field so a
 * physical count keeps its rhythm.
 */

function SubmitButton(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      Record count
    </ActionButton>
  );
}

export function CountEntry({ sessionId }: { sessionId: string }): React.ReactNode {
  const [state, formAction] = useActionState<CountLineState, FormData>(saveCountLine, null);
  const formRef = useRef<HTMLFormElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      skuRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={styles.countEntry} noValidate>
      <input type="hidden" name="session_id" value={sessionId} />
      <label className={styles.addField}>
        <span className={styles.addLabel}>SKU</span>
        <input
          ref={skuRef}
          name="sku"
          type="text"
          className={styles.addInput}
          placeholder="RBH-4471"
          autoComplete="off"
          required
        />
      </label>
      <label className={styles.addField}>
        <span className={styles.addLabel}>Counted quantity</span>
        <input
          name="counted_qty"
          type="number"
          min="0"
          step="any"
          className={styles.addInput}
          placeholder="0"
          autoComplete="off"
          required
        />
      </label>
      <div className={styles.countEntrySubmit}>
        <SubmitButton />
      </div>
      {state?.ok === false ? (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p className={styles.countSaved} role="status">
          {state.sku} counted at {state.countedQty}.
        </p>
      ) : null}
    </form>
  );
}
