import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ReorderInsightPanel } from '@/components/InsightPanel/ReorderInsightPanel';
import { WeeklyChangeInsightPanel } from '@/components/InsightPanel/WeeklyChangeInsightPanel';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { isMemberRole, type MemberRole } from '@/lib/access';
import { listOpenAlerts } from '@/lib/alerts/queue';
import { countActiveProducts, loadSupplierOtif } from '@/lib/dashboard/queries';
import { buildTodayFocusFacts } from '@/lib/dashboard/role-focus';
import {
  dashboardStage,
  mostUsedSupplier,
  pickMostPressingOpenPo,
  stockoutCount,
  throughputLast7Days,
  worstDaysOfSupply,
} from '@/lib/dashboard/transform';
import { locationHref } from '@/lib/locations/href';
import { resolveLocationScope } from '@/lib/locations/scope';
import { loadOnboardingState } from '@/lib/onboarding/queries';
import { onboardingComplete } from '@/lib/onboarding/state';
import { loadPlanSnapshot } from '@/lib/plan/queries';
import { listPurchaseOrders } from '@/lib/purchase-orders/queries';
import { buildOrderChain, openPoCount, orderConnector } from '@/lib/purchase-orders/transform';
import { loadReorderQueue } from '@/lib/reorder/queue';
import { createSupabaseServer } from '@/lib/supabase/server';
import { loadTransferRecommendations } from '@/lib/transfers/recommend';
import { RecentAlerts } from './RecentAlerts';
import { RoleTodayPanel } from './RoleTodayPanel';
import { ThroughputRuler } from './ThroughputRuler';
import { type ChainStepView, TodayChain } from './TodayChain';
import styles from './today.module.css';

export const metadata = { title: 'Today · The Chain' };

function dosTone(dos: number): 'stop' | 'warn' | 'flow' {
  if (dos < 7) return 'stop';
  if (dos < 14) return 'warn';
  return 'flow';
}

function otifTone(otif: number): 'stop' | 'warn' | 'flow' {
  if (otif >= 0.9) return 'flow';
  if (otif >= 0.75) return 'warn';
  return 'stop';
}

const STRIP_KEYS = ['AT STOCKOUT RISK', 'WORST DAYS OF SUPPLY', 'TOP SUPPLIER OTIF', 'OPEN ORDERS'];

/**
 * Today — the inventory-health dashboard (Block 15). The daily landing surface:
 * the most-pressing in-flight PO as the visible chain centerpiece (its active
 * link a cobalt heartbeat until acknowledged), a metric strip of the numbers
 * that decide the day, Claude's read + recent alerts in the right column, and a
 * 7-day throughput ruler along the bottom. Reads are RLS-scoped; the page only
 * shapes what's already tenant-fenced. Renders three stages: fresh, onboarding,
 * and populated.
 */
export default async function TodayPage(
  { searchParams }: { searchParams: Promise<{ location?: string }> } = {
    searchParams: Promise.resolve({}),
  },
): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const { data: claimsData } = await supabase.auth.getClaims();
  const roleClaim = claimsData?.claims?.tenant_role;
  if (!claimsData?.claims?.tenant_id) redirect('/signin');
  const role: MemberRole = isMemberRole(roleClaim) ? roleClaim : 'viewer';
  const locationId = await resolveLocationScope(supabase, (await searchParams).location);
  const [pos, groups, alerts, otifBySupplier, productCount, onboarding] = await Promise.all([
    listPurchaseOrders(supabase, locationId),
    loadReorderQueue(supabase, locationId),
    listOpenAlerts(supabase),
    loadSupplierOtif(supabase),
    countActiveProducts(supabase),
    loadOnboardingState(supabase),
  ]);

  // A tenant that hasn't finished (or opted out of) onboarding belongs in the
  // guided flow, not on a bench they can't read yet (Block 2). Legacy tenants
  // predating onboarding have a catalog but no state row — onboardingComplete
  // treats that as done, so the guard never traps an existing account.
  if (!onboardingComplete(onboarding, productCount)) {
    redirect('/onboarding');
  }

  const nowMs = Date.now();
  const stage = dashboardStage(productCount > 0, pos, groups, alerts);

  // Empty bench: a tenant who opted out of onboarding (seed-only) lands here with
  // no catalog yet. Offer both ingest paths so the genuine next step is in reach.
  if (stage === 'fresh') {
    return (
      <div className={pageStyles.stack}>
        <PageHeader eyebrow="The bench · waiting on a source" title="Today" />
        <Panel prefix="Get started" title="Your bench is empty">
          <div className={pageStyles.connect}>
            <p className={pageStyles.connectCopy}>
              The Chain reads your catalog, suppliers, and purchase history, then watches every PO
              advance link by link. Connect a source and the bench fills in place — recommendations,
              the live order chain, and your daily numbers all land here.
            </p>
            <div className={styles.ctaRow}>
              <Link href="/integrations" className={pageStyles.cta}>
                Connect a source
              </Link>
              <Link href="/import" className={pageStyles.headerLink}>
                or import a spreadsheet →
              </Link>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  // Onboarding: catalog is in, but the engine hasn't produced an actionable
  // surface yet (no orders, no recommendations). Preview the shape; tell the
  // operator what's forming.
  if (stage === 'onboarding') {
    return (
      <div className={pageStyles.stack}>
        <PageHeader eyebrow="Your workshop is forming" title="Today" />
        <div className={pageStyles.strip}>
          {STRIP_KEYS.map((key) => (
            <div key={key} className={styles.metricLink}>
              <MetricCell label={key} value={null} />
            </div>
          ))}
        </div>
        <Panel prefix="Setting up" title="The Chain is forecasting your demand">
          <div className={pageStyles.connect}>
            <p className={pageStyles.connectCopy}>
              Your catalog is in. The Chain is computing demand forecasts and your first reorder
              points now. Recommendations, the live order chain, and your daily numbers land here
              after the first batch — usually within a few minutes of an import.
            </p>
            <Link href={locationHref('/forecasts', locationId)} className={pageStyles.headerLink}>
              Watch the forecast run →
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const capturedAt = new Date().toISOString();
  const [plan, approvalsResult, countResult, transferRecommendations] = await Promise.all([
    loadPlanSnapshot(supabase, { capturedAt, locationId }),
    supabase
      .from('requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted'),
    (() => {
      let query = supabase
        .from('cycle_count_sessions')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'in_progress']);
      if (locationId) query = query.eq('location_id', locationId);
      return query;
    })(),
    role === 'warehouse' ? loadTransferRecommendations(supabase) : Promise.resolve([]),
  ]);
  if (approvalsResult.error) {
    throw new Error(`today approvals failed: ${approvalsResult.error.message}`);
  }
  if (countResult.error) {
    throw new Error(`today cycle counts failed: ${countResult.error.message}`);
  }

  const mostPressing = pickMostPressingOpenPo(pos);
  const stockouts = stockoutCount(groups);
  const worst = worstDaysOfSupply(groups);
  const supplier = mostUsedSupplier(pos, otifBySupplier);
  const buckets = throughputLast7Days(pos, nowMs);
  const topAlert = alerts[0] ?? null;
  const reorderCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const dueCutoff = nowMs + 7 * 24 * 60 * 60 * 1000;
  const receiptsDue = pos.filter((po) => {
    if (!['approved', 'exported', 'sent', 'partial_received'].includes(po.status)) return false;
    if (!po.expectedDeliveryAt) return false;
    return new Date(po.expectedDeliveryAt).getTime() <= dueCutoff;
  }).length;
  const scopedTransfers = locationId
    ? transferRecommendations.filter(
        (row) => row.sourceLocationId === locationId || row.destinationLocationId === locationId,
      )
    : transferRecommendations;
  const supplierExposure = new Set(
    pos
      .filter((po) => ['approved', 'exported', 'sent', 'partial_received'].includes(po.status))
      .map((po) => po.supplierId),
  ).size;
  const focusFacts = buildTodayFocusFacts(
    role,
    {
      coveragePct: plan.coveragePct,
      commitment: plan.openPoCommitment,
      approvals: approvalsResult.count ?? 0,
      stockouts,
      missingForecasts: plan.dataQualityCount,
      reorderCount,
      receiptsDue,
      heldUnits: plan.heldUnits,
      cycleCounts: countResult.count ?? 0,
      transfers: scopedTransfers.length,
      inventoryValue: plan.inventoryValue,
      supplierExposure,
      uncoveredUnits: plan.uncoveredDemandUnits,
    },
    locationId,
  );

  let steps: ChainStepView[] = [];
  let activeIndex = -1;
  if (mostPressing) {
    const chain = buildOrderChain({
      status: mostPressing.status,
      supplierName: mostPressing.supplierName,
      reference: mostPressing.reference,
      expectedDeliveryAt: mostPressing.expectedDeliveryAt,
      actualDeliveryAt: mostPressing.actualDeliveryAt,
    });
    steps = chain.map((s, i) => ({
      step: s.step,
      label: s.label,
      when: s.when,
      state: s.state,
      connector: orderConnector(s.state, i === chain.length - 1),
    }));
    activeIndex = steps.findIndex((s) => s.state === 'active');
  }

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Your workshop, today" title="Today" />

      {/* Metric strip — the numbers that decide the day. Each is clickable. */}
      <div className={pageStyles.strip}>
        <Link href={locationHref('/reorder', locationId)} className={styles.metricLink}>
          <MetricCell
            label="AT STOCKOUT RISK"
            value={stockouts}
            tone={stockouts > 0 ? 'stop' : 'deep'}
          />
        </Link>
        <Link
          href={locationHref(
            worst ? `/inventory/${worst.productId}` : '/inventory/policy',
            locationId,
          )}
          className={styles.metricLink}
        >
          <MetricCell
            label="WORST DAYS OF SUPPLY"
            value={worst ? worst.dos.toFixed(1) : null}
            unit="days"
            tone={worst ? dosTone(worst.dos) : 'deep'}
          />
        </Link>
        <Link
          href={supplier ? `/suppliers/${supplier.supplierId}` : '/suppliers'}
          className={styles.metricLink}
        >
          <MetricCell
            label={supplier ? `OTIF · ${supplier.supplierName.toUpperCase()}` : 'TOP SUPPLIER OTIF'}
            value={supplier?.otifPct != null ? (supplier.otifPct * 100).toFixed(1) : null}
            unit="%"
            tone={supplier?.otifPct != null ? otifTone(supplier.otifPct) : 'deep'}
          />
        </Link>
        <Link href={locationHref('/purchase-orders', locationId)} className={styles.metricLink}>
          <MetricCell label="OPEN ORDERS" value={openPoCount(pos)} />
        </Link>
      </div>

      <RoleTodayPanel role={role} facts={focusFacts} planHref={locationHref('/plan', locationId)} />

      <div className={styles.body}>
        <div className={styles.main}>
          {mostPressing ? (
            <Panel prefix="Today's chain" title={`${mostPressing.supplierName} · in flight`}>
              <TodayChain
                steps={steps}
                activeIndex={activeIndex}
                reference={mostPressing.reference}
                poHref={locationHref(`/purchase-orders/${mostPressing.id}`, locationId)}
                topAlertId={topAlert?.id ?? null}
                topAlertMemo={topAlert?.memo ?? null}
              />
            </Panel>
          ) : (
            <Panel
              prefix="Today's chain"
              title="No active order"
              empty
              emptyMessage="No active chain — your workshop is at rest. The moment an order is in flight, it forms a chain here and its active link picks up a heartbeat."
            />
          )}

          <Panel prefix="Throughput · last 7 days" title="Orders completed">
            <ThroughputRuler buckets={buckets} />
          </Panel>
        </div>

        <aside className={styles.rail} aria-label="Today's context">
          <Panel prefix="Claude" title="Today's top recommendation">
            {mostPressing ? (
              <ReorderInsightPanel poId={mostPressing.id} />
            ) : (
              <WeeklyChangeInsightPanel />
            )}
          </Panel>

          <Panel
            prefix="Alerts"
            title="Needs your eye"
            actions={
              alerts.length > 0 ? (
                <Link href="/flow/alerts" className={pageStyles.headerLink}>
                  All {alerts.length} →
                </Link>
              ) : undefined
            }
          >
            <RecentAlerts alerts={alerts.slice(0, 4)} nowMs={nowMs} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
