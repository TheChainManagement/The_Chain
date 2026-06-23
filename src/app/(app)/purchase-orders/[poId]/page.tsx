import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { ReorderInsightPanel } from '@/components/InsightPanel/ReorderInsightPanel';
import { MetricCell } from '@/components/MetricCell/MetricCell';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { loadReorderContext } from '@/lib/insights/reorder-context';
import { getPurchaseOrder } from '@/lib/purchase-orders/queries';
import {
  fmtDate,
  fmtMoney,
  isApprovablePo,
  isReceivablePo,
  poStatusLabel,
} from '@/lib/purchase-orders/transform';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getSupplierDetail } from '@/lib/suppliers/queries';
import { OrderChain } from '../OrderChain';
import { ApproveControls } from './ApproveControls';
import styles from './po-detail.module.css';
import { ReceiveControls } from './ReceiveControls';
import { SupplierReliabilityPanel } from './SupplierReliabilityPanel';

export const metadata = { title: 'Purchase Order · The Chain' };

/**
 * PO detail + receive surface (Block 10). The order rendered as the full
 * igniting chain, the lines with ordered vs received, and — for an open order —
 * the receive control whose confirmation writes the supplier_performance row
 * and lights the supplier's reliability ribbon.
 */
export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}): Promise<ReactNode> {
  const { poId } = await params;
  const supabase = await createSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = (claims?.claims?.tenant_id as string | undefined) ?? '';
  const po = await getPurchaseOrder(supabase, poId);
  if (!po) notFound();

  const approvable = isApprovablePo(po.status);
  const receivable = isReceivablePo(po.status);

  // The policy numbers the reorder insight narrates — rendered on-screen so every
  // figure Claude cites is verifiable (trust hierarchy). Null when no policy yet.
  // The supplier's rolling-30d reliability is loaded alongside so it sits right
  // where the approve/receive decision is made (FEATURES.md:451).
  const [ctx, supplier] = await Promise.all([
    loadReorderContext(supabase, tenantId, po.id),
    getSupplierDetail(supabase, po.supplierId),
  ]);
  const hasContext =
    ctx != null &&
    (ctx.onHand != null ||
      ctx.daysOfSupply != null ||
      ctx.reorderPoint != null ||
      ctx.stockoutRiskPct != null);

  return (
    <div className={pageStyles.stack}>
      <Link href="/purchase-orders" className={styles.back}>
        ← Purchase Orders
      </Link>

      <PageHeader
        eyebrow={`Order · ${po.supplierName}`}
        title={po.reference}
        actions={
          <span className={styles.headerActions}>
            <a className={styles.exportLink} href={`/api/exports/po/${po.id}.csv`}>
              Export CSV
            </a>
            <span className={styles.statusTag}>{poStatusLabel(po.status)}</span>
          </span>
        }
      />

      <section className={styles.hero} aria-label={`Order ${po.reference} progress`}>
        <OrderChain po={po} />
      </section>

      {supplier ? <SupplierReliabilityPanel supplier={supplier} /> : null}

      <Panel
        prefix="Lines"
        title={`${po.lines.length} ${po.lines.length === 1 ? 'line' : 'lines'}`}
        actions={
          <Link href={`/suppliers/${po.supplierId}`} className={styles.supplierLink}>
            {po.supplierName} →
          </Link>
        }
      >
        <div className={styles.lines}>
          <div className={styles.linesHead} aria-hidden="true">
            <span>SKU</span>
            <span className={styles.numHead}>Ordered</span>
            <span className={styles.numHead}>Received</span>
            <span className={styles.numHead}>Unit cost</span>
          </div>
          {po.lines.map((l) => {
            const full = l.receivedQty >= l.orderedQty;
            return (
              <div key={l.lineNo} className={styles.line}>
                <span className={styles.lineSku}>
                  <Link href={`/inventory/${l.productId}`} className={styles.lineLink}>
                    {l.sku}
                  </Link>
                  <span className={styles.lineName}>{l.name}</span>
                </span>
                <span className={styles.lineNum}>
                  <StatNumber value={l.orderedQty} />
                </span>
                <span className={styles.lineNum}>
                  <StatNumber value={l.receivedQty} tone={full ? 'flow' : 'mid'} />
                </span>
                <span className={styles.lineNum}>
                  <StatNumber
                    value={l.unitCost == null ? null : fmtMoney(l.unitCost)}
                    unit="$"
                    unitPosition="prefix"
                  />
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <span className={styles.summaryKey}>Ordered</span>
            <span className={styles.summaryVal}>{fmtDate(po.createdAt)}</span>
          </span>
          {po.expectedDeliveryAt ? (
            <span className={styles.summaryItem}>
              <span className={styles.summaryKey}>Promised</span>
              <span className={styles.summaryVal}>{fmtDate(po.expectedDeliveryAt)}</span>
            </span>
          ) : null}
          {po.actualDeliveryAt ? (
            <span className={styles.summaryItem}>
              <span className={styles.summaryKey}>Delivered</span>
              <span className={styles.summaryVal}>{fmtDate(po.actualDeliveryAt)}</span>
            </span>
          ) : null}
          {po.total != null ? (
            <span className={styles.summaryItem}>
              <span className={styles.summaryKey}>Total</span>
              <span className={styles.summaryVal}>
                <StatNumber value={fmtMoney(po.total)} unit="$" unitPosition="prefix" />
              </span>
            </span>
          ) : null}
        </div>

        {approvable ? <ApproveControls poId={po.id} /> : null}
        {receivable ? <ReceiveControls poId={po.id} lines={po.lines} /> : null}
      </Panel>

      {hasContext && ctx ? (
        <Panel prefix="Reorder context" title="Why this order fired">
          <div className={pageStyles.strip}>
            <MetricCell label="ON HAND" value={ctx.onHand} />
            <MetricCell label="DAYS OF SUPPLY" value={ctx.daysOfSupply} unit="days" />
            <MetricCell label="REORDER POINT" value={ctx.reorderPoint} />
            <MetricCell label="STOCKOUT RISK" value={ctx.stockoutRiskPct} unit="%" />
          </div>
        </Panel>
      ) : null}

      <ReorderInsightPanel poId={po.id} />
    </div>
  );
}
