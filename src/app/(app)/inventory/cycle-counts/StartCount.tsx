'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import styles from '../inventory.module.css';
import { type StartCountState, startCountSession } from './actions';

/**
 * StartCount — header CTA that opens a new count session and lands on its entry
 * page (the action redirects on success, so this island only owns the error).
 */

function SubmitButton({ disabled }: { disabled: boolean }): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending} disabled={disabled}>
      Start a count
    </ActionButton>
  );
}

export function StartCount({ locationId }: { locationId: string | null }): React.ReactNode {
  const [state, formAction] = useActionState<StartCountState, FormData>(startCountSession, null);
  return (
    <form action={formAction} className={styles.countStart}>
      <input type="hidden" name="location_id" value={locationId ?? ''} />
      <SubmitButton disabled={!locationId} />
      {!locationId ? (
        <span className={styles.formError}>Select a location to start a physical count.</span>
      ) : null}
      {state?.ok === false ? (
        <span className={styles.formError} role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
