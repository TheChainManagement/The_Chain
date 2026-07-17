'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import type { LinkDefault, RfqDetail } from '@/lib/procurement/queries';
import {
  type AwardPick,
  buildQuoteRow,
  canEnterQuotes,
  type VendorQuoteCell,
} from '@/lib/procurement/transform';
import {
  awardQuotesToRequisition,
  markVendorDeclined,
  type RfqEditState,
  saveVendorQuote,
} from '../../actions';
import styles from './quote-grid.module.css';

/**
 * QuoteGrid — the comparison grid (W2-3 slice 3, THE memorable element).
 * Rows = RFQ lines, columns = vendors. An empty cell is the entry affordance
 * (one entry panel at a time, pre-filled from the supplier link); an answered
 * cell shows the quoted cost with its per-stock-unit read; the cheapest
 * answered cell per row carries the cobalt ignite; clicking answered cells
 * assembles the requisition in the award tray ("get three quotes", answered
 * on one bench). "Award column" takes every line that vendor quoted.
 */

interface EntryTarget {
  lineNo: number;
  supplierId: string;
}

function pickKey(p: EntryTarget): string {
  return `${p.lineNo}:${p.supplierId}`;
}

function EntrySubmit(): React.ReactNode {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending} variant="secondary">
      Save quote
    </ActionButton>
  );
}

export function QuoteGrid({
  rfq,
  linkDefaults,
}: {
  rfq: RfqDetail;
  linkDefaults: LinkDefault[];
}): React.ReactNode {
  const router = useRouter();
  const open = canEnterQuotes(rfq.status).ok;
  const [entry, setEntry] = useState<EntryTarget | null>(null);
  const [picks, setPicks] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saveState, saveAction] = useActionState<RfqEditState, FormData>(saveVendorQuote, null);

  useEffect(() => {
    if (saveState?.ok) {
      setEntry(null);
      router.refresh();
    }
  }, [saveState, router]);

  // Per-line comparison rows, cheapest flagged (pure).
  const rows = useMemo(() => {
    const byLine = new Map<number, VendorQuoteCell[]>();
    for (const line of rfq.lines) {
      byLine.set(line.lineNo, buildQuoteRow(rfq.quotes.filter((q) => q.lineNo === line.lineNo)));
    }
    return byLine;
  }, [rfq.lines, rfq.quotes]);

  const pickedCells = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const [lineNo, supplierId] of picks) {
      const cell = rows.get(lineNo)?.find((c) => c.supplierId === supplierId);
      const line = rfq.lines.find((l) => l.lineNo === lineNo);
      if (cell && line) {
        const purchaseQty = Math.max(line.qty / (cell.factor ?? 1), cell.moq ?? 0);
        total += purchaseQty * cell.quotedUnitCost;
        count += 1;
      }
    }
    return { total: Math.round(total * 100) / 100, count };
  }, [picks, rows, rfq.lines]);

  function togglePick(lineNo: number, supplierId: string) {
    setError(null);
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.get(lineNo) === supplierId) {
        next.delete(lineNo);
      } else {
        next.set(lineNo, supplierId);
      }
      return next;
    });
  }

  function awardColumn(supplierId: string) {
    setError(null);
    setPicks((prev) => {
      const next = new Map(prev);
      for (const line of rfq.lines) {
        if (rows.get(line.lineNo)?.some((c) => c.supplierId === supplierId)) {
          next.set(line.lineNo, supplierId);
        }
      }
      return next;
    });
  }

  function decline(supplierId: string) {
    setError(null);
    startTransition(async () => {
      const res = await markVendorDeclined({ rfqId: rfq.id, supplierId });
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function award() {
    setError(null);
    const awardPicks: AwardPick[] = [...picks.entries()].map(([lineNo, supplierId]) => ({
      lineNo,
      supplierId,
    }));
    startTransition(async () => {
      const res = await awardQuotesToRequisition({ rfqId: rfq.id, picks: awardPicks });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPicks(new Map());
      router.refresh();
    });
  }

  const entryDefaults = useMemo(() => {
    if (!entry) {
      return { uom: '', factor: '' };
    }
    const line = rfq.lines.find((l) => l.lineNo === entry.lineNo);
    const existing = rfq.quotes.find(
      (q) => q.lineNo === entry.lineNo && q.supplierId === entry.supplierId,
    );
    if (existing) {
      return { uom: existing.purchaseUom ?? '', factor: existing.factor?.toString() ?? '' };
    }
    const link = linkDefaults.find(
      (d) => d.productId === line?.productId && d.supplierId === entry.supplierId,
    );
    return { uom: link?.purchaseUom ?? '', factor: link?.factor?.toString() ?? '' };
  }, [entry, rfq.lines, rfq.quotes, linkDefaults]);

  const existingEntry = entry
    ? rfq.quotes.find((q) => q.lineNo === entry.lineNo && q.supplierId === entry.supplierId)
    : undefined;
  const entryLine = entry ? rfq.lines.find((l) => l.lineNo === entry.lineNo) : undefined;
  const entryVendor = entry
    ? rfq.vendors.find((v) => v.supplierId === entry.supplierId)
    : undefined;

  return (
    <div className={styles.wrap} data-testid="quote-grid">
      <div className={styles.gridHead}>
        <span>Quotes · cheapest per line ignites</span>
        <span>
          {rfq.vendors.filter((v) => v.status === 'quoted').length}/{rfq.vendors.length} vendors
          answered
        </span>
      </div>

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.skuCell}>Line</th>
              {rfq.vendors.map((v) => (
                <th key={v.supplierId}>
                  <span className={styles.vendorHead}>
                    <span className={styles.vendorHeadName}>{v.supplierName}</span>
                    <span className={styles.vendorHeadActions}>
                      {v.status === 'declined' ? (
                        <span className={styles.vendorDeclined}>DECLINED</span>
                      ) : (
                        <>
                          {open ? (
                            <button
                              type="button"
                              className={styles.vendorHeadBtn}
                              onClick={() => awardColumn(v.supplierId)}
                            >
                              Award column
                            </button>
                          ) : null}
                          {open && v.status === 'pending' ? (
                            <button
                              type="button"
                              className={styles.vendorHeadBtn}
                              onClick={() => decline(v.supplierId)}
                            >
                              No bid
                            </button>
                          ) : null}
                        </>
                      )}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rfq.lines.map((line) => {
              const cells = rows.get(line.lineNo) ?? [];
              return (
                <tr key={line.lineNo}>
                  <td className={styles.skuCell}>
                    <span className={styles.skuCode}>{line.sku}</span>
                    <span className={styles.skuQty}>
                      {line.qty} {line.stockUom ?? 'each'}
                    </span>
                  </td>
                  {rfq.vendors.map((v) => {
                    const cell = cells.find((c) => c.supplierId === v.supplierId);
                    const picked = picks.get(line.lineNo) === v.supplierId;
                    if (!cell) {
                      return (
                        <td key={v.supplierId}>
                          {open && v.status !== 'declined' ? (
                            <button
                              type="button"
                              className={`${styles.cell} ${styles.cellEmpty}`}
                              onClick={() =>
                                setEntry({ lineNo: line.lineNo, supplierId: v.supplierId })
                              }
                              aria-label={`Enter ${v.supplierName} quote for ${line.sku}`}
                            >
                              Enter quote
                            </button>
                          ) : (
                            <span className={styles.cellMeta}>—</span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={v.supplierId}>
                        <button
                          type="button"
                          className={styles.cell}
                          data-cheapest={cell.cheapest || undefined}
                          data-picked={picked || undefined}
                          onClick={() => togglePick(line.lineNo, v.supplierId)}
                          onDoubleClick={() =>
                            open
                              ? setEntry({ lineNo: line.lineNo, supplierId: v.supplierId })
                              : undefined
                          }
                          aria-label={`${v.supplierName} quoted ${line.sku} at ${cell.quotedUnitCost}${picked ? ' (picked)' : ''}${cell.cheapest ? ' (cheapest)' : ''}`}
                          aria-pressed={picked}
                        >
                          <span className={styles.cellCost}>
                            ${cell.quotedUnitCost.toFixed(2)}
                            {cell.purchaseUom ? ` / ${cell.purchaseUom}` : ''}
                          </span>
                          <span className={styles.cellMeta}>
                            ${cell.perStockUnit.toFixed(4)} per {line.stockUom ?? 'each'}
                            {cell.leadTimeDays != null ? ` · ${cell.leadTimeDays}d` : ''}
                            {cell.moq != null ? ` · MOQ ${cell.moq}` : ''}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {entry && entryLine && entryVendor ? (
        <form action={saveAction} className={styles.entry} key={pickKey(entry)}>
          <span className={styles.entryTitle}>
            {entryVendor.supplierName} · {entryLine.sku} ({entryLine.qty}{' '}
            {entryLine.stockUom ?? 'each'} requested)
          </span>
          <input type="hidden" name="rfq_id" value={rfq.id} />
          <input type="hidden" name="supplier_id" value={entry.supplierId} />
          <input type="hidden" name="line_no" value={entry.lineNo} />
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>Unit price</span>
            <input
              name="cost"
              type="number"
              min="0"
              step="any"
              defaultValue={existingEntry?.quotedUnitCost}
              autoComplete="off"
              required
            />
          </label>
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>Their unit</span>
            <input
              name="purchase_uom"
              type="text"
              placeholder="CS"
              defaultValue={entryDefaults.uom}
              autoComplete="off"
            />
          </label>
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>= stock units</span>
            <input
              name="factor"
              type="number"
              min="0"
              step="any"
              placeholder="1"
              defaultValue={entryDefaults.factor}
              autoComplete="off"
            />
          </label>
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>Lead (days)</span>
            <input
              name="lead_time_days"
              type="number"
              min="0"
              step="1"
              defaultValue={existingEntry?.leadTimeDays ?? undefined}
              autoComplete="off"
            />
          </label>
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>MOQ</span>
            <input
              name="moq"
              type="number"
              min="0"
              step="1"
              defaultValue={existingEntry?.moq ?? undefined}
              autoComplete="off"
            />
          </label>
          <label className={styles.vendorHead}>
            <span className={styles.cellMeta}>Note</span>
            <input
              name="note"
              type="text"
              defaultValue={existingEntry?.note ?? undefined}
              autoComplete="off"
            />
          </label>
          <EntrySubmit />
          {saveState?.ok === false ? (
            <p className={styles.error} role="alert">
              {saveState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {open ? (
        <div className={styles.tray}>
          <span className={styles.trayReads}>
            <span>
              <span className={styles.trayKey}>Picked</span>
              <span className={styles.trayValue}>
                {pickedCells.count}/{rfq.lines.length} lines
              </span>
            </span>
            <span>
              <span className={styles.trayKey}>Est. total</span>
              <span className={styles.trayValue}>${pickedCells.total.toFixed(2)}</span>
            </span>
          </span>
          <ActionButton onClick={award} loading={pending} disabled={pickedCells.count === 0}>
            {rfq.draftedRequisitions.some((row) => row.isCurrentVersion)
              ? 'Create re-award'
              : 'Draft requisition'}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
