'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { type AuthState, activateProvision } from '../actions';
import styles from '../auth.module.css';

interface ActivationFormProps {
  provisionId: string;
  requiresPasswordChange: boolean;
}

function Submit({ requiresPasswordChange }: { requiresPasswordChange: boolean }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending
        ? 'Activating'
        : requiresPasswordChange
          ? 'Replace password and enter'
          : 'Activate access'}
    </ActionButton>
  );
}

export function ActivationForm({ provisionId, requiresPasswordChange }: ActivationFormProps) {
  const [state, formAction] = useActionState<AuthState, FormData>(activateProvision, null);
  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="provision_id" value={provisionId} />
      {requiresPasswordChange ? (
        <>
          <label className={styles.field}>
            <span className={styles.label}>New password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              className={styles.input}
              placeholder="At least 6 characters"
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Confirm new password</span>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              className={styles.input}
              placeholder="Same password again"
              required
            />
          </label>
        </>
      ) : null}
      {state?.ok === false ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className={styles.submit}>
        <Submit requiresPasswordChange={requiresPasswordChange} />
      </div>
    </form>
  );
}
