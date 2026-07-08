import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from '../auth.module.css';
import { UpdatePasswordForm } from '../ResetForms';

export const metadata = { title: 'Set a new password · The Chain' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className={styles.screen} aria-hidden="true" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

/**
 * Reached from the recovery email via /api/auth/confirm, which establishes the
 * recovery session before forwarding here. No session means the link was bad or
 * expired, so we bounce to the request form with the expired notice.
 */
async function ResetPasswordInner() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/forgot-password?error=expired');
  }

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <ChainGlyph />
          THE CHAIN
        </span>
        <div className={styles.heading}>
          <h1 className={styles.title}>Set a new password</h1>
          <p className={styles.sub}>
            Pick a new password for {user.email ?? 'your account'} and you are back at the bench.
          </p>
        </div>

        <UpdatePasswordForm />
      </div>
    </main>
  );
}
