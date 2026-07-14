import { redirect } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { BenchAtmosphere } from '@/components/bench/BenchAtmosphere';
import { LeftRail } from '@/components/bench/LeftRail';
import { RightRail } from '@/components/bench/RightRail';
import { hasAppAccess } from '@/lib/billing/plans';
import { loadSubscription } from '@/lib/billing/subscription';
import { listLocations } from '@/lib/locations/queries';
import { loadOperatingProfile } from '@/lib/modes/resolver';
import { createSupabaseServer } from '@/lib/supabase/server';
import styles from './bench.module.css';

/**
 * (app) segment — the Working Bench.
 *
 * The static bench chrome (grid + ambient motion) prerenders; the per-user,
 * cookie-reading parts live in `BenchGate`, wrapped in <Suspense> so Cache
 * Components can stream them without blocking the shell (Next 16 requires
 * uncached/dynamic reads to sit inside a Suspense boundary).
 *
 * BenchGate IS THE PRIMARY AUTH GATE (per the proxy.ts defense-in-depth
 * disposition): a server-side getUser() that redirects unauthenticated requests
 * to /signin before any protected content streams. RLS is the data-layer gate;
 * the proxy only refreshes sessions.
 */

async function BenchGate({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin');
  }

  // Authentication is not enough. The bench requires a real membership in the
  // tenant the JWT actually carries — not just any tenant. getClaims() verifies
  // the token (JWKS) and returns the custom tenant_id claim minted by the access
  // token hook (which itself only emits tenant_id when membership exists). If the
  // token carries a tenant the user no longer belongs to (stale role/removal),
  // the scoped membership check below returns zero and we bounce to /signin.
  const { data: claimsData } = await supabase.auth.getClaims();
  const tenantId = claimsData?.claims?.tenant_id as string | undefined;

  if (!tenantId) {
    redirect('/signin');
  }

  const { count } = await supabase
    .from('tenant_members')
    .select('tenant_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId);

  if (!count || count < 1) {
    redirect('/signin');
  }

  // Hard paywall (Block 16): a verified member still needs an active (or comp)
  // subscription to reach the bench. No access → the gated plan picker, which
  // also handles past_due/canceled (Manage billing) for existing customers.
  // Read via the admin client because subscriptions are RLS-readable by
  // owner/finance only, but the paywall must hold for every role; tenantId was
  // just verified above, so the service-role read stays tenant-scoped.
  const sub = await loadSubscription(tenantId);
  if (!hasAppAccess(sub?.status)) {
    redirect('/choose-plan');
  }

  // W2-0: resolve the tenant's operating profile once, here, so the rail can fit
  // nav + terminology to its industry. The engine stays mode-agnostic.
  const profile = await loadOperatingProfile(tenantId);
  const locations = (await listLocations(supabase))
    .filter((location) => location.active)
    .map(({ id, name, isPrimary }) => ({ id, name, isPrimary }));

  return (
    <>
      <LeftRail userEmail={user.email ?? ''} profile={profile} locations={locations} />
      <main className={styles.surface}>{children}</main>
      <RightRail />
      <div className={styles.throughput} aria-hidden="true">
        <span className={styles.todayTick} />
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.bench}>
      <BenchAtmosphere />
      <Suspense fallback={<div className={styles.gateFallback} aria-hidden="true" />}>
        <BenchGate>{children}</BenchGate>
      </Suspense>
    </div>
  );
}
