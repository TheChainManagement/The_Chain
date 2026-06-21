import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { signOut } from '@/app/(auth)/actions';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { requireMember } from '@/lib/billing/guard';
import { hasAppAccess, PLAN_INFO } from '@/lib/billing/plans';
import { loadSubscription } from '@/lib/billing/subscription';
import { startCheckout, startPortal } from './actions';
import styles from './choose-plan.module.css';

export const metadata: Metadata = { title: 'Choose your plan · The Chain' };

const STATUS_NOTE: Record<string, string> = {
  past_due: 'Your last payment didn’t go through. Update your billing to restore access.',
  canceled: 'Your subscription is canceled. Pick a plan to start again.',
};

/**
 * The hard-paywall gate (Block 16). Reached when a signed-in member has no active
 * subscription. Self-serve Starter/Growth/Pro → Stripe Checkout; Enterprise →
 * contact. Existing customers (past_due/canceled) also get a Manage-billing link
 * into the Stripe Customer Portal. Auth-gated, but NOT behind the bench paywall.
 */
export default function ChoosePlan({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; canceled?: string }>;
}) {
  return (
    <Suspense fallback={<main className={styles.screen} aria-hidden="true" />}>
      <ChoosePlanInner searchParams={searchParams} />
    </Suspense>
  );
}

async function ChoosePlanInner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; canceled?: string }>;
}) {
  const { tenantId } = await requireMember();

  const sub = await loadSubscription(tenantId);
  if (hasAppAccess(sub?.status)) redirect('/today');

  const { error, canceled } = await searchParams;
  const statusNote = sub?.status ? STATUS_NOTE[sub.status] : undefined;
  const hasCustomer = Boolean(sub?.billing_customer_id);

  return (
    <main className={styles.screen}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <span className={styles.brand}>
            <ChainGlyph />
            THE CHAIN
          </span>
          <h1 className={styles.title}>Choose your plan</h1>
          <p className={styles.sub}>
            Pick the tier that fits your operation. You’re charged today and get full access right
            away — change tiers or cancel anytime.
          </p>
          {statusNote ? <p className={styles.statusNote}>{statusNote}</p> : null}
          {error ? (
            <p className={styles.errorNote}>
              Something went wrong starting that. Please try again.
            </p>
          ) : null}
          {canceled ? (
            <p className={styles.statusNote}>Checkout canceled — no charge was made.</p>
          ) : null}
        </header>

        <div className={styles.plans}>
          {PLAN_INFO.map((p) => (
            <div key={p.tier} className={styles.plan} data-popular={p.popular ?? false}>
              {p.popular ? <span className={styles.tag}>Most popular</span> : null}
              <h2 className={styles.planName}>{p.name}</h2>
              <div className={styles.price}>
                <span className={styles.amount}>${p.priceMonthly}</span>
                <span className={styles.per}>/mo</span>
              </div>
              <p className={styles.blurb}>{p.blurb}</p>
              <form action={startCheckout}>
                <input type="hidden" name="tier" value={p.tier} />
                <button type="submit" className={styles.choose} data-popular={p.popular ?? false}>
                  Get {p.name}
                </button>
              </form>
              <ul className={styles.features}>
                {p.features.map((f) => (
                  <li key={f} className={styles.feature}>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.footNote}>
            Need multi-entity or custom terms?{' '}
            <a href="/contact" className={styles.footLink}>
              Talk to us about Enterprise
            </a>
            .
          </span>
          <div className={styles.footActions}>
            {hasCustomer ? (
              <form action={startPortal}>
                <button type="submit" className={styles.ghost}>
                  Manage billing
                </button>
              </form>
            ) : null}
            <form action={signOut}>
              <button type="submit" className={styles.ghost}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
