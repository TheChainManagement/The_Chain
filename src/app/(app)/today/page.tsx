import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ReorderInsightPanel } from '@/components/InsightPanel/ReorderInsightPanel';
import { WeeklyChangeInsightPanel } from '@/components/InsightPanel/WeeklyChangeInsightPanel';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { listOpenAlerts } from '@/lib/alerts/queue';
import { countActiveProducts, loadSupplierOtif } from '@/lib/dashboard/queries';
import {
  dashboardStage,
  mostUsedSupplier,
  pickMostPressingOpenPo,
  stockoutCount,
  throughputLast7Days,
  worstDaysOfSupply,
} from '@/lib/dashboard/transform';
import { loadOnboardingState } from '@/lib/onboarding/queries';
import { onboardingComplete } from '@/lib/onboarding/state';
import { listPurchaseOrders } from '@/lib/purchase-orders/queries';
import { buildOrderChain, openPoCount, orderConnector } from '@/lib/purchase-orders/transform';
import { loadReorderQueue } from '@/lib/reorder/queue';
import { createSupabaseServer } from '@/lib/supabase/server';
import { RecentAlerts } from './RecentAlerts';
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
export default async function TodayPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const [pos, groups, alerts, otifBySupplier, productCount, onboarding] = await Promise.all([
    listPurchaseOrders(supabase),
    loadReorderQueue(supabase),
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
            <Link href="/forecasts" className={pageStyles.headerLink}>
              Watch the forecast run →
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const mostPressing = pickMostPressingOpenPo(pos);
  const stockouts = stockoutCount(groups);
  const worst = worstDaysOfSupply(groups);
  const supplier = mostUsedSupplier(pos, otifBySupplier);
  const buckets = throughputLast7Days(pos, nowMs);
  const topAlert = alerts[0] ?? null;

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
        <Link href="/reorder" className={styles.metricLink}>
          <MetricCell
            label="AT STOCKOUT RISK"
            value={stockouts}
            tone={stockouts > 0 ? 'stop' : 'deep'}
          />
        </Link>
        <Link
          href={worst ? `/inventory/${worst.productId}` : '/inventory/policy'}
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
        <Link href="/purchase-orders" className={styles.metricLink}>
          <MetricCell label="OPEN ORDERS" value={openPoCount(pos)} />
        </Link>
      </div>

      <div className={styles.body}>
        <div className={styles.main}>
          {mostPressing ? (
            <Panel prefix="Today's chain" title={`${mostPressing.supplierName} · in flight`}>
              <TodayChain
                steps={steps}
                activeIndex={activeIndex}
                reference={mostPressing.reference}
                poHref={`/purchase-orders/${mostPressing.id}`}
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
