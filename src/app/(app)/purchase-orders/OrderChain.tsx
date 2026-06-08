import type { ReactNode } from 'react';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import {
  buildOrderChain,
  orderConnector,
  type PurchaseOrderListRow,
} from '@/lib/purchase-orders/transform';
import styles from './purchase-orders.module.css';

/**
 * OrderChain — the cockpit's memorable element. The featured order rendered as
 * the full igniting chain: SUPPLIER → ORDERED → IN TRANSIT → RECEIVED, each link
 * lit cobalt to the point the order has reached (the signature motion lives in
 * ChainLink). It turns "PO-1001, open" into a thing you watch advance.
 */
export function OrderChain({ po }: { po: PurchaseOrderListRow }): ReactNode {
  const steps = buildOrderChain({
    status: po.status,
    supplierName: po.supplierName,
    reference: po.reference,
    expectedDeliveryAt: po.expectedDeliveryAt,
    actualDeliveryAt: po.actualDeliveryAt,
  });

  return (
    <ul className={styles.heroChain} aria-label={`Order ${po.reference} progress`}>
      {steps.map((step, i) => (
        <li key={step.step} className={styles.heroCell}>
          <ChainLink
            step={step.step}
            label={step.label}
            when={step.when}
            state={step.state}
            connector={orderConnector(step.state, i === steps.length - 1)}
          />
        </li>
      ))}
    </ul>
  );
}
