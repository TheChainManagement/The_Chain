import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { qboEnv } from '@/lib/env';
import { getKindSpec } from '@/lib/import/field-specs';
import { loadOnboardingCounts, loadOnboardingState } from '@/lib/onboarding/queries';
import { onboardingComplete, resolveOnboarding } from '@/lib/onboarding/state';
import { getQboStatus } from '@/lib/qbo/connection';
import { createSupabaseServer } from '@/lib/supabase/server';
import { CompleteControls } from './CompleteControls';
import { FirstProductForm } from './FirstProductForm';
import { FirstSupplierForm } from './FirstSupplierForm';
import { OnboardingChain } from './OnboardingChain';
import { OnboardingImportPanel } from './OnboardingImportPanel';
import { OnboardingQboPanel } from './OnboardingQboPanel';
import styles from './onboarding.module.css';
import { PathPicker } from './PathPicker';
import { SkipSetup } from './SkipSetup';

export const metadata = { title: 'Set up your workshop · The Chain' };

/**
 * Onboarding (Block 2). The five-link chain forms in front of the operator —
 * continuous from the sign-up morph — and each link lights as a step completes.
 * The fresh path runs inline (first product → first supplier → first forecast).
 * QuickBooks and spreadsheet paths run IN the flow too (Wave 2b): the QBO connect
 * + first sync and the CSV import workbench are embedded here, so the chain fills
 * in place. A completed (or legacy) tenant never lands here — the guard sends them
 * to /today.
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

  // Load only what the active import path needs for its inline panel (Wave 2b).
  let qboConnected = false;
  let qboConfigured = false;
  if (view.path === 'qbo') {
    try {
      qboEnv();
      qboConfigured = true;
    } catch {
      qboConfigured = false; // QBO env not set on this deploy — panel shows unavailable.
    }
    const { data: claims } = await supabase.auth.getClaims();
    const tenantId = claims?.claims?.tenant_id as string | undefined;
    const qboStatus = tenantId ? await getQboStatus(supabase, tenantId) : { connected: false };
    qboConnected = qboStatus.connected;
  }
  const importSpecs =
    view.path === 'csv'
      ? [getKindSpec('product'), getKindSpec('supplier'), getKindSpec('stock_movement')]
      : [];

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
        view.path === 'qbo' ? (
          <Panel prefix="Bring in your data" title="QuickBooks Online">
            <OnboardingQboPanel connected={qboConnected} configured={qboConfigured} />
          </Panel>
        ) : (
          <Panel prefix="Bring in your data" title="Import a spreadsheet">
            <OnboardingImportPanel specs={importSpecs} />
          </Panel>
        )
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
