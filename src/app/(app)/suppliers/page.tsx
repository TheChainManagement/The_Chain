import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { createSupabaseServer } from '@/lib/supabase/server';
import { listSuppliers, type SupplierListRow } from '@/lib/suppliers/queries';
import { otifPercent, otifTone } from '@/lib/suppliers/transform';
import { AddSupplier } from './AddSupplier';
import styles from './suppliers.module.css';

export const metadata = { title: 'Suppliers · The Chain' };

/**
 * Suppliers — the source roster (Block 4). Server Component: RLS-scoped suppliers
 * with linked-product count, default lead time, and rolling-30d OTIF. OTIF reads
 * through <StatNumber> with semantic tone (flow/warn/stop), never cobalt.
 */
export default async function SuppliersPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const rows = await listSuppliers(supabase);

  return (
    <div className={pageStyles.stack}>
      <PageHeader
        eyebrow="Sources · lead time + reliability"
        title="Suppliers"
        actions={<AddSupplier />}
      />

      {rows.length === 0 ? (
        <Panel
          prefix="Sources"
          title="No suppliers on the bench yet"
          empty
          emptyMessage="Add your first supplier, then link them to the SKUs they source."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.head} aria-hidden="true">
            <span>Supplier</span>
            <span className={styles.numHead}>SKUs</span>
            <span className={styles.numHead}>Lead time</span>
            <span className={styles.numHead}>OTIF</span>
            <span>Status</span>
          </div>
          {rows.map((row) => (
            <SupplierRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierRow({ row }: { row: SupplierListRow }): ReactNode {
  return (
    <Link href={`/suppliers/${row.id}`} className={styles.row} aria-label={row.name}>
      <span className={styles.cellName}>{row.name}</span>
      <span className={styles.cellNum}>
        <StatNumber value={row.productCount} />
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={row.defaultLeadTimeDays} unit="days" />
      </span>
      <span className={styles.cellNum}>
        <StatNumber
          value={otifPercent(row.otifPct)}
          unit="%"
          tone={otifTone(row.otifPct)}
          aria-label={row.otifPct == null ? 'no OTIF yet' : undefined}
        />
      </span>
      <span className={styles.cellStatus}>
        <StatusTag status={row.status} />
      </span>
    </Link>
  );
}

function StatusTag({ status }: { status: SupplierListRow['status'] }): ReactNode {
  const active = status === 'active';
  return (
    <span className={`${styles.statusTag} ${active ? styles.statusActive : styles.statusOff}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {active ? 'Active' : 'Archived'}
    </span>
  );
}
