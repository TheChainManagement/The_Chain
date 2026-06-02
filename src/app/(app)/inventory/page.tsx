import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { type InventoryListRow, listInventory } from '@/lib/inventory/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { AddSku } from './AddSku';
import styles from './inventory.module.css';

export const metadata = { title: 'Inventory · The Chain' };

/**
 * Inventory — the SKU catalog ledger (Block 3). Server Component: reads the
 * RLS-scoped catalog and renders a dense, hairline-divided ledger (no cards).
 * On-hand renders through <StatNumber>; the whole row routes to the SKU's bench.
 */
export default async function InventoryPage(): Promise<ReactNode> {
  const supabase = await createSupabaseServer();
  const rows = await listInventory(supabase);

  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Catalog · on-hand by SKU" title="Inventory" actions={<AddSku />} />

      {rows.length === 0 ? (
        <Panel
          prefix="Catalog"
          title="No SKUs on the bench yet"
          empty
          emptyMessage="Add your first SKU, or connect a source to import your whole catalog at once."
        />
      ) : (
        <div className={styles.ledger}>
          <div className={styles.head} aria-hidden="true">
            <span>SKU</span>
            <span>Product</span>
            <span className={styles.numHead}>On hand</span>
            <span>A · X</span>
            <span>Status</span>
          </div>
          {rows.map((row) => (
            <InventoryRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function InventoryRow({ row }: { row: InventoryListRow }): ReactNode {
  return (
    <Link
      href={`/inventory/${row.id}`}
      className={styles.row}
      aria-label={`${row.sku} — ${row.name}`}
    >
      <span className={styles.cellSku}>{row.sku}</span>
      <span className={styles.cellName}>
        {row.name}
        {row.unitOfMeasure ? <span className={styles.uom}>{row.unitOfMeasure}</span> : null}
      </span>
      <span className={styles.cellNum}>
        <StatNumber value={fmtQty(row.onHand)} />
      </span>
      <span className={styles.cellClass}>
        <ClassTag abc={row.abcClass} xyz={row.xyzClass} />
      </span>
      <span className={styles.cellStatus}>
        <StatusTag status={row.status} />
      </span>
    </Link>
  );
}

function ClassTag({ abc, xyz }: { abc: string | null; xyz: string | null }): ReactNode {
  if (!abc && !xyz) {
    return <span className={styles.classPending}>—</span>;
  }
  return (
    <span className={styles.classTag}>
      <span className={styles.classAbc}>{abc ?? '·'}</span>
      <span className={styles.classDot} aria-hidden="true" />
      <span className={styles.classXyz}>{xyz ?? '·'}</span>
    </span>
  );
}

function StatusTag({ status }: { status: InventoryListRow['status'] }): ReactNode {
  const active = status === 'active';
  return (
    <span className={`${styles.statusTag} ${active ? styles.statusActive : styles.statusOff}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {active ? 'Active' : 'Discontinued'}
    </span>
  );
}
