import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { getRfqDetail, listLinkDefaults, listSkuOptions } from '@/lib/procurement/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { listSupplierOptions } from '@/lib/suppliers/queries';
import { RfqChainTrack } from '../../RfqChainTrack';
import { QuoteGrid } from './QuoteGrid';
import gridStyles from './quote-grid.module.css';
import { RfqLines, RfqStatusActions, RfqVendors } from './RfqWorkbench';
import styles from './rfq.module.css';

export const metadata = { title: 'Quote request · The Chain' };

/**
 * RFQ detail (W2-3 slice 2): the request's working bench. Draft = editable
 * lines + vendor set; sent = locked document with per-vendor exports live.
 */
export default async function RfqDetailPage({
  params,
}: {
  params: Promise<{ rfqId: string }>;
}): Promise<ReactNode> {
  const { rfqId } = await params;
  const supabase = await createSupabaseServer();
  const rfq = await getRfqDetail(supabase, rfqId);
  if (!rfq) {
    notFound();
  }

  const [skuOptions, supplierOptions, linkDefaults] = await Promise.all([
    listSkuOptions(supabase),
    listSupplierOptions(supabase),
    listLinkDefaults(
      supabase,
      rfq.lines.map((l) => l.productId),
    ),
  ]);

  const gridLive = rfq.status !== 'draft' && rfq.status !== 'canceled';

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Procurement · request for quote"
        title={rfq.title}
        actions={<RfqStatusActions rfq={rfq} />}
      />

      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Chain</span>
          <RfqChainTrack status={rfq.status} />
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Buying for</span>
          <span className={styles.metaValue}>{rfq.locationName}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Respond by</span>
          <span className={styles.metaValue}>{rfq.respondBy ?? 'open'}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Sent</span>
          <span className={styles.metaValue}>
            {rfq.sentAt ? new Date(rfq.sentAt).toLocaleDateString() : 'not yet'}
          </span>
        </div>
      </div>

      {rfq.draftedRequisitions.length > 0 ? (
        <div className={gridStyles.drafted} role="status">
          <span className={gridStyles.draftedText}>
            {rfq.draftedRequisitions.length === 1
              ? 'A requisition has been drafted from this request.'
              : `${rfq.draftedRequisitions.length} requisitions have been drafted from this request.`}
          </span>
          <span className={gridStyles.draftedMeta}>
            {rfq.draftedRequisitions
              .map(
                (r) =>
                  `${r.status.toUpperCase()}${r.total != null ? ` · $${r.total.toFixed(2)}` : ''}`,
              )
              .join('  ·  ')}
            {' — the requisitions bench lands in the next slice'}
          </span>
        </div>
      ) : null}

      {gridLive ? <QuoteGrid rfq={rfq} linkDefaults={linkDefaults} /> : null}

      <div className={styles.columns}>
        <RfqLines rfq={rfq} skuOptions={skuOptions} />
        <RfqVendors rfq={rfq} supplierOptions={supplierOptions} />
      </div>
    </div>
  );
}
