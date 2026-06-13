/**
 * PO → CSV (Block 11b export). Pure, no I/O — the route handler does the read
 * and auth; this turns a `PurchaseOrderDetail` into the bytes an operator can
 * hand to a supplier when there is no QBO write-back. One row per line, with the
 * order header echoed so the file stands alone.
 */

import type { PurchaseOrderDetail } from './transform';
import { poStatusLabel } from './transform';

const HEADER = [
  'po_reference',
  'supplier',
  'status',
  'expected_delivery',
  'line_no',
  'sku',
  'product',
  'ordered_qty',
  'received_qty',
  'unit_cost',
  'line_total',
] as const;

/** RFC-4180 cell: quote when the value holds a comma, quote, or newline. */
function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function purchaseOrderToCsv(po: PurchaseOrderDetail): string {
  const rows: string[] = [HEADER.join(',')];
  const expected = po.expectedDeliveryAt ? po.expectedDeliveryAt.slice(0, 10) : '';

  for (const l of po.lines) {
    const lineTotal = l.unitCost == null ? '' : (l.unitCost * l.orderedQty).toFixed(2);
    rows.push(
      [
        cell(po.reference),
        cell(po.supplierName),
        cell(poStatusLabel(po.status)),
        cell(expected),
        cell(l.lineNo),
        cell(l.sku),
        cell(l.name),
        cell(l.orderedQty),
        cell(l.receivedQty),
        cell(l.unitCost == null ? '' : l.unitCost.toFixed(2)),
        cell(lineTotal),
      ].join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}
