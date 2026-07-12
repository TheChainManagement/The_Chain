import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { listLocationOptions, listRfqs, type RfqListRow } from '@/lib/procurement/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { NewRfq } from './NewRfq';
import styles from './procurement.module.css';
import { RfqChainTrack } from './RfqChainTrack';

export const metadata = { title: 'Procurement · The Chain' };

/**
 * Procurement — quote requests (W2-3 slice 2). The RFQ ledger: every request
 * with its status chain, line/vendor counts, and respond-by. Requisitions join
 * this bench in slice 4. Server Component; reads are RLS-scoped.
 */
export default async function ProcurementPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const [rfqs, locations] = await Promise.all([listRfqs(supabase), listLocationOptions(supabase)]);

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Procurement · request for quote"
        title="Quote requests"
        actions={<NewRfq locations={locations} />}
      />

      {rfqs.length === 0 ? (
        <Panel
          prefix="Procurement"
          title="No quote requests yet"
          empty
          emptyMessage="Open a request by hand, or select SKUs on the Reorder bench and choose Request quotes."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.head} aria-hidden="true">
            <span>Request</span>
            <span>Chain</span>
            <span className={styles.numHead}>Lines</span>
            <span className={styles.numHead}>Vendors</span>
            <span className={styles.numHead}>Quoted</span>
            <span>Respond by</span>
          </div>
          {rfqs.map((row) => (
            <RfqRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function RfqRow({ row }: { row: RfqListRow }): ReactNode {
  return (
    <Link href={`/procurement/rfqs/${row.id}`} className={styles.row} aria-label={row.title}>
      <span className={styles.cellTitle}>
        <span className={styles.cellTitleText}>{row.title}</span>
        <span className={styles.cellLocation}>{row.locationName}</span>
      </span>
      <span>
        <RfqChainTrack status={row.status} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.lineCount} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.vendorCount} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber
          value={row.vendorCount === 0 ? null : `${row.quotedVendorCount}/${row.vendorCount}`}
        />
      </span>
      <span className={styles.cellMuted}>{row.respondBy ?? '—'}</span>
    </Link>
  );
}
