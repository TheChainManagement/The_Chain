import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { loadOnboardingCounts, loadOnboardingState } from '@/lib/onboarding/queries';
import { onboardingComplete, resolveOnboarding } from '@/lib/onboarding/state';
import { createSupabaseServer } from '@/lib/supabase/server';
import { CompleteControls } from './CompleteControls';
import { FirstProductForm } from './FirstProductForm';
import { FirstSupplierForm } from './FirstSupplierForm';
import { OnboardingChain } from './OnboardingChain';
import styles from './onboarding.module.css';
import { PathPicker } from './PathPicker';
import { SkipSetup } from './SkipSetup';

export const metadata = { title: 'Set up your workshop · The Chain' };

/**
 * Onboarding (Block 2, Wave 2a). The five-link chain forms in front of the
 * operator — continuous from the sign-up morph — and each link lights as a step
 * completes. The fresh path runs entirely inline (first product → first supplier
 * → first forecast). QuickBooks and spreadsheet paths hand off to the existing
 * connect/import surfaces; the chain still tracks their catalog/supplier minimums
 * from live counts (in-chain sync streaming is Wave 2b). A completed (or legacy)
 * tenant never lands here — the guard sends them to /today.
 */
export default async function OnboardingPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const [state, counts] = await Promise.all([
    loadOnboardingState(supabase),
    loadOnboardingCounts(supabase),
  ]);

  if (onboardingComplete(state, counts.products)) {
    redirect('/today');
  }

  const view = resolveOnboarding(state, counts);
  const isImportPath = view.path === 'qbo' || view.path === 'csv';
  const importHref = view.path === 'qbo' ? '/integrations/quickbooks' : '/import';
  const importLabel = view.path === 'qbo' ? 'Connect QuickBooks →' : 'Upload your spreadsheet →';

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow={`Building your workshop · ${view.litCount} of 5`}
        title="Set up The Chain"
      />

      <div className={styles.chainFrame}>
        <OnboardingChain links={view.links} />
      </div>

      {view.needsPathPick ? (
        <Panel prefix="First" title="How do you want to start?">
          <PathPicker />
        </Panel>
      ) : isImportPath && view.currentStep !== 'forecast' ? (
        <Panel prefix="Bring in your data" title="Connect your source">
          <div className={pageStyles.connect}>
            <p className={pageStyles.connectCopy}>
              {view.path === 'qbo'
                ? 'Connect QuickBooks Online and The Chain reads your items, vendors, and purchase history. Each link below lights as your data lands.'
                : 'Upload a CSV of your products, suppliers, and sales. Map the columns, preview, and import. Each link below lights as your data lands.'}
            </p>
            <Link href={importHref} className={pageStyles.cta}>
              {importLabel}
            </Link>
          </div>
        </Panel>
      ) : view.currentStep === 'catalog' ? (
        <Panel prefix="Step · catalog" title="Add your first product">
          <p className={styles.stepLead}>
            One product is enough to start. You can import the rest later — The Chain learns from
            whatever you give it.
          </p>
          <FirstProductForm />
        </Panel>
      ) : view.currentStep === 'suppliers' ? (
        <Panel prefix="Step · suppliers" title="Who supplies it?">
          <p className={styles.stepLead}>
            Add the supplier for that product. We link them as its primary source so the reorder
            chain has somewhere to point.
          </p>
          <FirstSupplierForm />
        </Panel>
      ) : view.currentStep === 'forecast' ? (
        <Panel prefix="Last step" title="Build your first forecast">
          <p className={styles.stepLead}>
            Your catalog and supplier are in. The Chain will forecast demand and compute your first
            reorder points, then open your bench.
          </p>
          <CompleteControls />
        </Panel>
      ) : null}

      {view.currentStep !== 'forecast' ? <SkipSetup /> : null}
    </div>
  );
}
