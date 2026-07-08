import Link from 'next/link';
import { Suspense } from 'react';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import styles from '../auth.module.css';
import { RequestResetForm } from '../ResetForms';

export const metadata = { title: 'Reset password · The Chain' };

export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<main className={styles.screen} aria-hidden="true" />}>
      <ForgotPasswordInner searchParams={searchParams} />
    </Suspense>
  );
}

async function ForgotPasswordInner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const expired = error === 'expired';

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <ChainGlyph />
          THE CHAIN
        </span>
        <div className={styles.heading}>
          <h1 className={styles.title}>Locked out of the workshop?</h1>
          <p className={styles.sub}>
            Enter the email you signed up with and we will send you a link to set a new password.
          </p>
        </div>

        {expired ? (
          <p className={styles.error} role="alert">
            That reset link expired or was already used. Request a fresh one below.
          </p>
        ) : null}

        <RequestResetForm />

        <p className={styles.alt}>
          Remembered it?{' '}
          <Link href="/signin" className={styles.altLink}>
            Back to sign in
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
