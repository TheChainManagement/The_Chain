import { redirect } from 'next/navigation';
import { startPortal } from '@/app/choose-plan/actions';
import { PageHeader } from '@/components/bench/PageHeader';
import { Panel } from '@/components/Panel/Panel';
import { PLAN_INFO } from '@/lib/billing/plans';
import { loadSubscription } from '@/lib/billing/subscription';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './billing.module.css';

export const metadata = { title: 'Billing · The Chain' };

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  comp: 'Complimentary',
  past_due: 'Payment past due',
  canceled: 'Canceled',
  incomplete: 'Awaiting payment',
};

const RETENTION_LABEL: Record<string, string> = {
  free: 'Minimal',
  starter: '1 year',
  standard: '5 years',
  pro: '10 years',
  enterprise: 'Unlimited',
};

/**
 * Billing settings (Block 16). Reached only by members with access (the paywall
 * gates the rest of the bench), so this is the manage surface: current plan,
 * status, retained-history window, and a link into the Stripe Customer Portal to
 * change card / tier / cancel. Comp accounts show as complimentary with no portal.
 */
export default async function BillingSettings() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;
  if (!tenantId) redirect('/signin');

  const sub = await loadSubscription(tenantId);
  const plan = PLAN_INFO.find((p) => p.tier === sub?.plan_code);
  const planName = plan?.name ?? (sub?.status === 'comp' ? 'Complimentary' : '—');
  const statusLabel = sub?.status ? (STATUS_LABEL[sub.status] ?? sub.status) : '—';
  const retention = sub?.retention_tier ? (RETENTION_LABEL[sub.retention_tier] ?? '—') : '—';
  const canManage = Boolean(sub?.billing_customer_id);

  return (
    <>
      <PageHeader eyebrow="Plan & billing" title="Billing" />

      <Panel
        prefix="Subscription"
        title="Current plan"
        actions={
          canManage ? (
            <form action={startPortal}>
              <button type="submit" className={styles.manage}>
                Manage billing
              </button>
            </form>
          ) : null
        }
      >
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={styles.label}>Plan</dt>
            <dd className={styles.value}>{planName}</dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.label}>Status</dt>
            <dd className={styles.value} data-status={sub?.status ?? 'none'}>
              {statusLabel}
            </dd>
          </div>
          {plan ? (
            <div className={styles.row}>
              <dt className={styles.label}>Price</dt>
              <dd className={styles.value}>${plan.priceMonthly}/mo</dd>
            </div>
          ) : null}
          <div className={styles.row}>
            <dt className={styles.label}>History retained</dt>
            <dd className={styles.value}>{retention}</dd>
          </div>
        </dl>
        {sub?.status === 'comp' ? (
          <p className={styles.note}>
            Complimentary access, managed by More Technologies. No payment required.
          </p>
        ) : null}
      </Panel>
    </>
  );
}
