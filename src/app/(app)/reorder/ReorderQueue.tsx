'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import { createRfqFromRecommendations } from '@/app/(app)/procurement/actions';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { locationHref } from '@/lib/locations/href';
import { type ReorderGroup, type ReorderRow, reorderGroupKey } from '@/lib/reorder/queue';
import type { ReorderUrgency } from '@/lib/reorder/recommend';
import { submitSelectedPurchaseRequest } from './actions';
import styles from './reorder.module.css';

/**
 * The reorder queue (Block 11) — the product's primary action loop. Open
 * recommendations grouped by (supplier, location); each row carries its reason
 * (the "why"). Select rows within one supplier and location group, then submit
 * them through the shared purchase-request approval policy. Selecting in a new
 * group clears the prior selection.
 */

const URGENCY_LABEL: Record<ReorderUrgency, string> = {
  stockout: 'OUT OF STOCK',
  below_safety: 'BELOW SAFETY',
  at_reorder: 'AT REORDER',
};
const URGENCY_TONE: Record<ReorderUrgency, 'stop' | 'warn' | 'mid'> = {
  stockout: 'stop',
  below_safety: 'warn',
  at_reorder: 'mid',
};

export function ReorderQueue({
  groups,
  locationId = null,
}: {
  groups: ReorderGroup[];
  locationId?: string | null;
}): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Show the location on every group when the tenant works more than one.
  const multiLocation = new Set(groups.map((g) => g.locationId)).size > 1;
  const selectedCount = selected.size;

  function toggle(group: ReorderGroup, rowId: string) {
    const groupKey = reorderGroupKey(group);
    setError(null);
    setSelected((prev) => {
      // Switching groups starts a fresh single-vendor, single-location request.
      const base = groupKey === selectedGroup ? new Set(prev) : new Set<string>();
      if (base.has(rowId)) base.delete(rowId);
      else base.add(rowId);
      setSelectedGroup(base.size > 0 ? groupKey : null);
      return base;
    });
  }

  function selectAll(group: ReorderGroup) {
    setError(null);
    setSelectedGroup(reorderGroupKey(group));
    setSelected(new Set(group.rows.map((r) => r.id)));
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const res = await submitSelectedPurchaseRequest({ recommendationIds: [...selected] });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const href =
        res.destination === 'purchase_order'
          ? `/purchase-orders/${res.poId}`
          : `/procurement/requisitions/${res.requisitionId}`;
      router.push(locationHref(href, locationId));
    });
  }

  // W2-3: the same selection becomes a draft RFQ instead of a PO. The
  // recommendations stay open — quoting precedes ordering.
  function requestQuotes() {
    setError(null);
    startTransition(async () => {
      const res = await createRfqFromRecommendations({ recommendationIds: [...selected] });
      if (!res?.ok) {
        setError(res?.error ?? 'Could not open the quote request.');
        return;
      }
      router.push(locationHref(`/procurement/rfqs/${res.rfqId}`, locationId));
    });
  }

  return (
    <div className={styles.queue} data-testid="reorder-queue">
      {groups.map((group) => {
        const groupKey = reorderGroupKey(group);
        const isActiveGroup = groupKey === selectedGroup;
        const label = multiLocation
          ? `${group.supplierName} · ${group.locationName}`
          : group.supplierName;
        return (
          <section key={groupKey} className={styles.group} aria-label={label}>
            <header className={styles.groupHead}>
              <div className={styles.groupSupplier}>
                <span className={styles.groupName}>{group.supplierName}</span>
                {multiLocation ? (
                  <span className={styles.groupLocation}>{group.locationName}</span>
                ) : null}
                <span className={styles.groupOtif}>
                  OTIF {group.otifPct == null ? '—' : `${Math.round(group.otifPct * 1000) / 10}%`}
                </span>
              </div>
              {group.convertible ? (
                <button type="button" className={styles.selectAll} onClick={() => selectAll(group)}>
                  Select all {group.rows.length}
                </button>
              ) : (
                <span className={styles.noSupplier}>Assign a supplier to order these</span>
              )}
            </header>

            <ul className={styles.rows}>
              {group.rows.map((row) => (
                <ReorderRowItem
                  key={row.id}
                  row={row}
                  checked={isActiveGroup && selected.has(row.id)}
                  disabled={!group.convertible}
                  onToggle={() => toggle(group, row.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <div className={styles.bar}>
        {error ? (
          <span className={styles.barError} role="alert">
            {error}
          </span>
        ) : null}
        <span className={styles.barCount}>
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select recommendations to order'}
        </span>
        <ActionButton
          variant="secondary"
          onClick={requestQuotes}
          loading={pending}
          disabled={selectedCount === 0}
        >
          Request quotes
        </ActionButton>
        <ActionButton
          variant="primary"
          onClick={convert}
          loading={pending}
          disabled={selectedCount === 0}
        >
          Submit purchase request
        </ActionButton>
      </div>
    </div>
  );
}

function ReorderRowItem({
  row,
  checked,
  disabled,
  onToggle,
}: {
  row: ReorderRow;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}): ReactNode {
  const reasonText = useMemo(() => reasonLine(row), [row]);
  return (
    <li className={styles.row} data-checked={checked || undefined}>
      <label className={styles.rowSelect}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      </label>
      <span className={styles.rowSku}>
        <span className={styles.rowSkuCode}>{row.sku}</span>
        <span className={styles.rowName}>{row.name}</span>
      </span>
      <span className={styles.rowUrgency} data-urgency={row.urgency}>
        <StatNumber
          value={URGENCY_LABEL[row.urgency]}
          tone={URGENCY_TONE[row.urgency]}
          aria-label={URGENCY_LABEL[row.urgency]}
        />
      </span>
      <span className={styles.rowReason}>{reasonText}</span>
      <span className={styles.rowQty}>
        <span className={styles.rowQtyKey}>ORDER</span>
        <StatNumber value={row.recommendedQty} />
      </span>
    </li>
  );
}

function reasonLine(row: ReorderRow): string {
  const r = row.reason;
  const dos = r.daysOfSupply == null ? '—' : `${r.daysOfSupply.toFixed(1)}d`;
  return `${r.position} on hand vs ${r.reorderPoint} reorder point · ${dos} of supply`;
}
