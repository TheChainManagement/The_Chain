'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ClassificationBadge } from '@/components/ClassificationBadge/ClassificationBadge';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import type { InventoryListRow } from '@/lib/inventory/queries';
import { uomLabel } from '@/lib/uom/units';
import { bulkArchiveProducts } from './actions';
import styles from './inventory.module.css';
import { type OperatorMode, OperatorPanel } from './OperatorPanel';

/**
 * InventoryLedger — the SKU ledger with row selection + a bulk-archive bar
 * (Block 3 bulk ops). Client island: owns the selection set. The SKU cell links
 * to the bench; the checkbox selects. Bulk archive runs through RLS, so only the
 * rows the caller may change are discontinued.
 *
 * W2-2: the bulk bar is also the storeroom's operator surface. Issue-archetype
 * tenants get "Issue selected" (one consuming object, N lines); every mode gets
 * "Adjust" on a single selection. Both open the OperatorPanel under the bar.
 */

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function InventoryLedger({
  rows,
  showIssue = false,
}: {
  rows: InventoryListRow[];
  showIssue?: boolean;
}): React.ReactNode {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<OperatorMode | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const activeIds = rows.filter((r) => r.status === 'active').map((r) => r.id);
  const allSelected = activeIds.length > 0 && activeIds.every((id) => selected.has(id));

  function toggle(id: string): void {
    setPanel(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll(): void {
    setPanel(null);
    setSelected(allSelected ? new Set() : new Set(activeIds));
  }

  function operatorDone(): void {
    setPanel(null);
    setSelected(new Set());
    router.refresh();
  }

  function archiveSelected(): void {
    setError(null);
    const ids = [...selected];
    startTransition(async () => {
      const result = await bulkArchiveProducts(ids);
      if (!result.ok) {
        setError(result.error);
      } else {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className={styles.ledgerWrap}>
      {selected.size > 0 ? (
        <section className={styles.bulkBar} aria-label="Bulk actions">
          <span className={styles.bulkCount}>{selected.size} selected</span>
          {showIssue ? (
            <button
              type="button"
              className={styles.bulkArchive}
              disabled={isPending}
              onClick={() => setPanel(panel === 'issue' ? null : 'issue')}
            >
              Issue selected
            </button>
          ) : null}
          {selected.size === 1 ? (
            <button
              type="button"
              className={styles.bulkArchive}
              disabled={isPending}
              onClick={() => setPanel(panel === 'adjust' ? null : 'adjust')}
            >
              Adjust
            </button>
          ) : null}
          <button
            type="button"
            className={styles.bulkArchive}
            disabled={isPending}
            onClick={archiveSelected}
          >
            Archive selected
          </button>
          <button
            type="button"
            className={styles.bulkClear}
            disabled={isPending}
            onClick={() => {
              setPanel(null);
              setSelected(new Set());
            }}
          >
            Clear
          </button>
          {error ? (
            <span className={styles.bulkError} role="alert">
              {error}
            </span>
          ) : null}
        </section>
      ) : null}

      {panel && selected.size > 0 ? (
        <OperatorPanel
          mode={panel}
          rows={rows.filter((r) => selected.has(r.id))}
          onDone={operatorDone}
          onCancel={() => setPanel(null)}
        />
      ) : null}

      <div className={styles.ledger}>
        <div className={styles.headSel} aria-hidden="true">
          <span className={styles.selCell}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="Select all active SKUs"
            />
          </span>
          <span>SKU</span>
          <span>Product</span>
          <span className={styles.numHead}>On hand</span>
          <span>A · X</span>
          <span>Status</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className={`${styles.rowSel} ${selected.has(row.id) ? styles.rowSelActive : ''}`}
          >
            <span className={styles.selCell}>
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
                disabled={row.status !== 'active'}
                aria-label={`Select ${row.sku}`}
              />
            </span>
            <Link href={`/inventory/${row.id}`} className={styles.cellSkuLink}>
              {row.sku}
            </Link>
            <span className={styles.cellName}>
              {row.name}
              {row.unitOfMeasure ? (
                <span className={styles.uom}>{uomLabel(row.unitOfMeasure)}</span>
              ) : null}
            </span>
            <span className={styles.cellNum}>
              <StatNumber value={fmtQty(row.onHand)} />
            </span>
            <span className={styles.cellClass}>
              <ClassificationBadge abc={row.abcClass} xyz={row.xyzClass} />
            </span>
            <span className={styles.cellStatus}>
              <StatusTag status={row.status} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: InventoryListRow['status'] }): React.ReactNode {
  const active = status === 'active';
  return (
    <span className={`${styles.statusTag} ${active ? styles.statusActive : styles.statusOff}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {active ? 'Active' : 'Discontinued'}
    </span>
  );
}
