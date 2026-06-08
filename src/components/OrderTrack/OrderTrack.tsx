import type { ReactNode } from 'react';
import { buildOrderChain, type PurchaseOrderListRow } from '@/lib/purchase-orders/transform';
import styles from './OrderTrack.module.css';

/**
 * OrderTrack — the compact form of the PO chain: four nodes
 * (SUPPLIER · ORDERED · IN TRANSIT · RECEIVED) joined by hairlines, the reached
 * ones lit cobalt. It's the at-a-glance status read in a cockpit row or a
 * supplier panel, where the full igniting ChainLink would be too heavy.
 *
 * Presentational and pure — the stage logic lives in `buildOrderChain`.
 */

export function OrderTrack({ po }: { po: PurchaseOrderListRow }): ReactNode {
  const steps = buildOrderChain({
    status: po.status,
    supplierName: po.supplierName,
    reference: po.reference,
    expectedDeliveryAt: po.expectedDeliveryAt,
    actualDeliveryAt: po.actualDeliveryAt,
  });
  const done = steps.filter((s) => s.state === 'done').length;
  const label = `Order progress: ${done} of ${steps.length} steps`;

  return (
    <span className={styles.track} role="img" aria-label={label}>
      {steps.map((s, i) => (
        <span key={s.step} className={styles.seg}>
          <span className={styles.node} data-state={s.state} title={s.step} />
          {i < steps.length - 1 ? (
            <span className={styles.bar} data-done={s.state === 'done' ? 'true' : 'false'} />
          ) : null}
        </span>
      ))}
    </span>
  );
}
