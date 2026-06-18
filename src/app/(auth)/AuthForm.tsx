'use client';

import { useRouter } from 'next/navigation';
import { type CSSProperties, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { type AuthState, signIn, signUp } from './actions';
import styles from './auth.module.css';

/**
 * Shared auth form for sign-in and sign-up. Client component: owns the
 * useActionState error channel + pending affordance. Inputs are token-styled
 * with a cobalt focus ring; the submit is an ActionButton (canonical CTA path).
 *
 * On sign-up success the action returns { ok: true } instead of redirecting, so
 * the signup screen morphs into the bench (rails slide in, the onboarding chain
 * ignites link by link) before navigating to /onboarding, where that same chain
 * persists and goes live (Block 2). The signup screen becomes the workshop — the
 * memorable element for this feature.
 */

// Onboarding chain shown forming during the post-signup transition. First link
// (Account) is already done; the rest ignite in sequence as the workshop builds.
const FORMING_STEPS = ['Account', 'Source', 'Catalog', 'Suppliers', 'Forecast'];

function WorkshopForming() {
  return (
    <div className={styles.forming} role="status" aria-live="polite">
      <span className={styles.formingRailLeft} aria-hidden="true" />
      <span className={styles.formingRailRight} aria-hidden="true" />
      <div className={styles.formingCore}>
        <span className={styles.formingLabel}>Building your workshop</span>
        <div className={styles.formingChain}>
          {FORMING_STEPS.map((step, i) => (
            <div
              key={step}
              className={styles.formingLink}
              style={{ '--link-index': i } as CSSProperties}
            >
              <span className={styles.formingIgnite} aria-hidden="true" />
              <span className={styles.formingStep}>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending}>
      {pending ? pendingLabel : label}
    </ActionButton>
  );
}

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const router = useRouter();
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, null);
  const igniting = mode === 'signup' && state?.ok === true;

  useEffect(() => {
    if (!igniting) return;
    // Navigate as the chain finishes forming. Whole transition stays under 800ms.
    // /onboarding carries the same five forming links, so the chain the operator
    // just watched ignite persists and becomes the live onboarding chain (Block 2).
    const timer = setTimeout(() => router.push('/onboarding'), 780);
    return () => clearTimeout(timer);
  }, [igniting, router]);

  if (igniting) {
    return <WorkshopForming />;
  }

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
