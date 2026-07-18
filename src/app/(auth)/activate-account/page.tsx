import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from '../auth.module.css';
import { ActivationForm } from './ActivationForm';

export const metadata = { title: 'Activate company access · The Chain' };

export default function ActivateAccountPage() {
  return (
    <Suspense fallback={<main className={styles.screen} aria-hidden="true" />}>
      <ActivateAccountInner />
    </Suspense>
  );
}

async function ActivateAccountInner() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const { data } = await supabase.rpc('my_pending_tenant_access');
  const provision = Array.isArray(data) ? data[0] : null;
  if (!provision) redirect('/today');

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <span className={styles.brand}>
          <ChainGlyph />
          THE CHAIN
        </span>
        <div className={styles.heading}>
          <h1 className={styles.title}>Activate {provision.tenant_name}</h1>
          <p className={styles.sub}>
            {provision.requires_password_change
              ? `Replace the temporary password for ${user.email ?? 'your account'} before entering as ${provision.proposed_role}.`
              : `Your existing account has been granted the ${provision.proposed_role} role. Activate it to enter this company.`}
          </p>
        </div>
        <ActivationForm
          provisionId={provision.provision_id}
          requiresPasswordChange={Boolean(provision.requires_password_change)}
        />
      </div>
    </main>
  );
}
