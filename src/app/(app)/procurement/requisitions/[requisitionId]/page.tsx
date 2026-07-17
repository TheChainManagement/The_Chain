import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { getRequisitionDetail, listDirectRequisitionOptions } from '@/lib/procurement/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { RequisitionChainTrack } from '../../RfqChainTrack';
import { RequisitionActions, RequisitionLines } from './RequisitionWorkbench';
import styles from './requisition.module.css';

export const metadata = { title: 'Requisition · The Chain' };

/**
 * Requisition detail (W2-3 slice 4): the approval document. Chain + decision
 * trail, purchase-UoM lines with the update-link-price affordance, and the
 * converted POs panel once the W2-3d RPC has run.
 */
export default async function RequisitionDetailPage({
  params,
}: {
  params: Promise<{ requisitionId: string }>;
}): Promise<ReactNode> {
  const { requisitionId } = await params;
  const supabase = await createSupabaseServer();
  const [requisition, lineOptions] = await Promise.all([
    getRequisitionDetail(supabase, requisitionId),
    listDirectRequisitionOptions(supabase),
  ]);
  if (!requisition) {
    notFound();
  }

  const { data: claims } = await supabase.auth.getClaims();
  const viewer = {
    userId: (claims?.claims?.sub as string | undefined) ?? null,
    role: (claims?.claims?.tenant_role as string | undefined) ?? '',
  };
  const currentAward = requisition.versionHistory.find((version) => version.isCurrentVersion);

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Procurement · requisition"
        title={requisition.sourceRfqTitle ? `From: ${requisition.sourceRfqTitle}` : 'Requisition'}
        actions={<RequisitionActions requisition={requisition} viewer={viewer} />}
      />

      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Chain</span>
          <RequisitionChainTrack status={requisition.status} />
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Buying for</span>
          <span className={styles.metaValue}>{requisition.locationName}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Total</span>
          <span className={styles.metaValue}>
            {requisition.total == null ? '—' : `$${requisition.total.toFixed(2)}`}
          </span>
        </div>
        {requisition.sourceRfqId ? (
          <div className={styles.metaItem}>
            <span className={styles.metaKey}>Award</span>
            <span className={styles.metaValue}>
              V{requisition.awardVersion} ·{' '}
              {requisition.isCurrentVersion ? 'current' : 'superseded'}
            </span>
          </div>
        ) : null}
        {requisition.sourceRfqId ? (
          <div className={styles.metaItem}>
            <span className={styles.metaKey}>Source</span>
            <Link href={`/procurement/rfqs/${requisition.sourceRfqId}`} className={styles.metaLink}>
              Quote request
            </Link>
          </div>
        ) : null}
      </div>

      {!requisition.isCurrentVersion ? (
        <div className={styles.superseded} role="status">
          <span>
            This award version is preserved as read-only history. Continue from the current version.
          </span>
          {currentAward ? (
            <Link href={`/procurement/requisitions/${currentAward.id}`} className={styles.metaLink}>
              Open current award
            </Link>
          ) : null}
        </div>
      ) : null}

      {requisition.versionHistory.length > 1 ? (
        <div className={styles.versions}>
          <div className={styles.versionsHead}>Award history</div>
          <div className={styles.versionLinks}>
            {requisition.versionHistory.map((version) => (
              <Link
                key={version.id}
                href={`/procurement/requisitions/${version.id}`}
                className={
                  version.id === requisition.id ? styles.versionActive : styles.versionLink
                }
              >
                V{version.awardVersion} · {version.isCurrentVersion ? 'CURRENT' : 'SUPERSEDED'} ·{' '}
                {version.status.toUpperCase()}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {requisition.status === 'rejected' && requisition.rejectionNote ? (
        <div className={styles.rejection} role="status">
          <span className={styles.rejectionKey}>Rejected</span>
          {requisition.rejectionNote}
        </div>
      ) : null}

      <RequisitionLines requisition={requisition} options={lineOptions} />

      {requisition.purchaseOrders.length > 0 ? (
        <div className={styles.pos}>
          <div className={styles.posHead}>
            <span>Purchase orders</span>
            <span>
              {requisition.purchaseOrders.length === 1
                ? '1 created from this requisition'
                : `${requisition.purchaseOrders.length} created from this requisition`}
            </span>
          </div>
          {requisition.purchaseOrders.map((po) => (
            <Link key={po.id} href={`/purchase-orders/${po.id}`} className={styles.poRow}>
              <span className={styles.poName}>{po.supplierName}</span>
              <span className={styles.poMeta}>
                {po.status.toUpperCase()}
                {po.total != null ? ` · $${po.total.toFixed(2)}` : ''}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
