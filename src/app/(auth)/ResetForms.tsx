'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { type AuthState, requestPasswordReset, updatePassword } from './actions';
import styles from './auth.module.css';

/**
 * Password reset forms (Wave 2 kickoff Item 0). Same client-form conventions as
 * AuthForm: useActionState error channel, token-styled inputs, ActionButton CTA.
 *
 * RequestResetForm swaps to a sent-confirmation once the action returns ok, and
 * stays enumeration-safe: the confirmation copy never says whether the email
 * matched an account.
 */

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending ? pendingLabel : label}
    </ActionButton>
  );
}

export function RequestResetForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(requestPasswordReset, null);

  if (state?.ok === true) {
    return (
      <p className={styles.sent} role="status">
        If that email has a workshop, a reset link is on its way. Open it within an hour and you are
        back in.
      </p>
    );
  }

  return (
    <form action={formAction} className={styles.form} noValidate>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          className={styles.input}
          placeholder="you@company.com"
          required
        />
      </label>

      {state?.ok === false ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={styles.submit}>
        <SubmitButton label="Send reset link" pendingLabel="Sending" />
      </div>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(updatePassword, null);

  return (
    <form action={formAction} className={styles.form} noValidate>
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

      {state?.ok === false ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={styles.submit}>
        <SubmitButton label="Set new password" pendingLabel="Saving" />
      </div>
    </form>
  );
}
