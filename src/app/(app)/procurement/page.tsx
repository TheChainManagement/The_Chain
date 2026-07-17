import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { locationHref } from '@/lib/locations/href';
import { resolveLocationScope } from '@/lib/locations/scope';
import {
  listDirectRequisitionOptions,
  listLocationOptions,
  listRequisitions,
  listRfqs,
  type RequisitionListRow,
  type RfqListRow,
} from '@/lib/procurement/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { NewRequisition } from './NewRequisition';
import { NewRfq } from './NewRfq';
import styles from './procurement.module.css';
import { RequisitionChainTrack, RfqChainTrack } from './RfqChainTrack';

export const metadata = { title: 'Procurement · The Chain' };

/**
 * Procurement — quote requests (W2-3 slice 2). The RFQ ledger: every request
 * with its status chain, line/vendor counts, and respond-by. Requisitions join
 * this bench in slice 4. Server Component; reads are RLS-scoped.
 */
export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const locationId = await resolveLocationScope(supabase, (await searchParams).location);
  const [rfqs, requisitions, locations, directOptions] = await Promise.all([
    listRfqs(supabase, locationId),
    listRequisitions(supabase, locationId),
    listLocationOptions(supabase),
    listDirectRequisitionOptions(supabase),
  ]);

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Procurement · request for quote"
        title="Quote requests"
        actions={<NewRfq locations={locations} selectedLocationId={locationId} />}
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
            <RfqRow key={row.id} row={row} locationId={locationId} />
          ))}
        </div>
      )}

      <PageHeader
        eyebrow="Procurement · approval before ordering"
        title="Requisitions"
        actions={
          <NewRequisition
            locations={locations}
            options={directOptions}
            selectedLocationId={locationId}
          />
        }
      />
      {requisitions.length === 0 ? (
        <Panel
          prefix="Procurement"
          title="No requisitions yet"
          empty
          emptyMessage="Award quotes on a request, or draft a direct requisition when you already know what needs approval."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.head} aria-hidden="true">
            <span>Requisition</span>
            <span>Chain</span>
            <span className={styles.numHead}>Lines</span>
            <span className={styles.numHead}>Vendors</span>
            <span className={styles.numHead}>Total</span>
            <span>Created</span>
          </div>
          {requisitions.map((row) => (
            <RequisitionRow key={row.id} row={row} locationId={locationId} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequisitionRow({
  row,
  locationId,
}: {
  row: RequisitionListRow;
  locationId: string | null;
}): ReactNode {
  const title = row.sourceRfqTitle
    ? `From: ${row.sourceRfqTitle} · V${row.awardVersion}${row.isCurrentVersion ? '' : ' · Superseded'}`
    : 'Direct requisition';
  return (
    <Link
      href={locationHref(`/procurement/requisitions/${row.id}`, locationId)}
      className={styles.row}
      aria-label={title}
    >
      <span className={styles.cellTitle}>
        <span className={styles.cellTitleText}>{title}</span>
        <span className={styles.cellLocation}>{row.locationName}</span>
      </span>
      <span>
        <RequisitionChainTrack status={row.status} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.lineCount} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.vendorCount} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.total == null ? null : `$${row.total.toFixed(2)}`} />
      </span>
      <span className={styles.cellMuted}>{row.createdAt.slice(0, 10)}</span>
    </Link>
  );
}

function RfqRow({ row, locationId }: { row: RfqListRow; locationId: string | null }): ReactNode {
  return (
    <Link
      href={locationHref(`/procurement/rfqs/${row.id}`, locationId)}
      className={styles.row}
      aria-label={row.title}
    >
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
