'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { type AuthState, signIn, signUp } from './actions';
import styles from './auth.module.css';

/**
 * Shared auth form for sign-in and sign-up. Client component: owns the
 * useActionState error channel + pending affordance. Inputs are token-styled
 * with a cobalt focus ring; the submit is an ActionButton (canonical CTA path).
 */

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending ? pendingLabel : label}
    </ActionButton>
  );
}

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, null);

  return (
    <form action={formAction} className={styles.form} noValidate>
      {mode === 'signup' ? (
        <label className={styles.field}>
          <span className={styles.label}>Business name</span>
          <input
            name="business"
            type="text"
            autoComplete="organization"
            className={styles.input}
            placeholder="Calhoun Foods"
            required
          />
        </label>
      ) : null}

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

      <label className={styles.field}>
        <span className={styles.label}>Password</span>
        <input
          name="password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          className={styles.input}
          placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
          required
        />
      </label>

      {state?.ok === false ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={styles.submit}>
        <SubmitButton
          label={mode === 'signin' ? 'Open the workshop' : 'Create my workshop'}
          pendingLabel={mode === 'signin' ? 'Opening' : 'Building'}
        />
      </div>
    </form>
  );
}
