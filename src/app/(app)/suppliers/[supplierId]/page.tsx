import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import { OrderTrack } from '@/components/OrderTrack/OrderTrack';
import { Panel } from '@/components/Panel/Panel';
import { ReliabilityRibbon } from '@/components/ReliabilityRibbon/ReliabilityRibbon';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import {
  listSupplierPurchaseOrders,
  type PurchaseOrderListRow,
} from '@/lib/purchase-orders/queries';
import { isOpenPo, poStatusLabel } from '@/lib/purchase-orders/transform';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getSupplierDetail, type SupplierDetail } from '@/lib/suppliers/queries';
import { type LinkedProduct, otifPercent, otifTone } from '@/lib/suppliers/transform';
import styles from './detail.module.css';
import { SupplierActions } from './SupplierActions';

export const metadata = { title: 'Supplier · The Chain' };

/**
 * Supplier detail — one source's bench. The memorable element is the reliability
 * ribbon at the top: the supplier's last deliveries as a row of cobalt / amber /
 * stop tiles, so you read their reputation at a glance (pending until POs land).
 */
export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}): Promise<ReactNode> {
  const { supplierId } = await params;
  const supabase = await createSupabaseServer();
  const [supplier, orders] = await Promise.all([
    getSupplierDetail(supabase, supplierId),
    listSupplierPurchaseOrders(supabase, supplierId),
  ]);

  if (!supplier) {
    notFound();
  }

  return (
    <div className={pageStyles.stack}>
      <Link href="/suppliers" className={styles.back}>
        ← Suppliers
      </Link>

      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        actions={
          <SupplierActions
            supplierId={supplier.id}
            name={supplier.name}
            email={(supplier.contact.email as string | undefined) ?? ''}
            phone={(supplier.contact.phone as string | undefined) ?? ''}
            defaultLeadTimeDays={supplier.defaultLeadTimeDays}
            minOrderValue={supplier.minOrderValue}
            status={supplier.status}
          />
        }
      />

      <section className={styles.ribbonPanel} aria-label="Reliability">
        <span className={styles.ribbonEyebrow}>Reliability</span>
        <ReliabilityRibbon tiles={supplier.reliability} />
      </section>

      <div className={styles.layout}>
        <TermsPanel supplier={supplier} />
        <ContactPanel supplier={supplier} />
        <ProductsPanel supplier={supplier} />
      </div>

      <PurchaseOrdersPanel orders={orders} />
    </div>
  );
}

function PurchaseOrdersPanel({ orders }: { orders: PurchaseOrderListRow[] }): ReactNode {
  if (orders.length === 0) {
    return (
      <Panel
        prefix="Procurement"
        title="Purchase orders"
        empty
        emptyMessage="No purchase orders for this supplier yet. They appear here once you sync QuickBooks or raise a reorder."
      />
    );
  }

  return (
    <Panel prefix="Procurement" title="Purchase orders">
      <ul className={styles.poList}>
        {orders.map((po) => (
          <li key={po.id} className={styles.poRow}>
            <span className={styles.poRef}>{po.reference}</span>
            <OrderTrack po={po} />
            <span className={styles.poMeta}>
              <StatNumber
                value={po.total == null ? null : fmtMoney(po.total)}
                unit="$"
                unitPosition="prefix"
              />
              <span
                className={`${styles.poStatus} ${isOpenPo(po.status) ? styles.poStatusOpen : styles.poStatusDone}`}
              >
                {poStatusLabel(po.status)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TermsPanel({ supplier }: { supplier: SupplierDetail }): ReactNode {
  return (
    <Panel prefix="Terms" title="Lead time + reliability">
      <div className={styles.terms}>
        <div className={styles.termCell}>
          <span className={styles.termKey}>Default lead time</span>
          <StatNumber value={supplier.defaultLeadTimeDays} unit="days" size="panel" />
        </div>
        <div className={styles.termCell}>
          <span className={styles.termKey}>Min order</span>
          <StatNumber
            value={supplier.minOrderValue == null ? null : fmtMoney(supplier.minOrderValue)}
            unit="$"
            unitPosition="prefix"
            size="panel"
          />
        </div>
        <div className={styles.termCell}>
          <span className={styles.termKey}>OTIF (30d)</span>
          <StatNumber
            value={otifPercent(supplier.otifPct)}
            unit="%"
            tone={otifTone(supplier.otifPct)}
            size="panel"
            aria-label={supplier.otifPct == null ? 'no OTIF yet' : undefined}
          />
        </div>
        <div className={styles.termCell}>
          <span className={styles.termKey}>Sample</span>
          <StatNumber value={supplier.scorecardSampleSize || null} unit="POs" size="panel" />
        </div>
      </div>
    </Panel>
  );
}

function ContactPanel({ supplier }: { supplier: SupplierDetail }): ReactNode {
  const email = supplier.contact.email as string | undefined;
  const phone = supplier.contact.phone as string | undefined;
  const empty = !email && !phone && !supplier.qboVendorId;

  if (empty) {
    return (
      <Panel
        prefix="Contact"
        title="Contact"
        empty
        emptyMessage="No contact details yet. Add an email or phone so reorder POs have somewhere to go."
      />
    );
  }

  return (
    <Panel prefix="Contact" title="Contact">
      <dl className={styles.idList}>
        <IdentityRow label="Email" value={email ?? '—'} />
        <IdentityRow label="Phone" value={phone ?? '—'} />
        {supplier.qboVendorId ? (
          <IdentityRow label="QBO vendor" value={supplier.qboVendorId} mono />
        ) : null}
      </dl>
    </Panel>
  );
}

function ProductsPanel({ supplier }: { supplier: SupplierDetail }): ReactNode {
  if (supplier.products.length === 0) {
    return (
      <Panel
        prefix="Catalog"
        title="Products sourced"
        empty
        emptyMessage="No SKUs linked yet. Link this supplier from a SKU's bench to set cost, lead time, and MOQ."
      />
    );
  }

  return (
    <Panel prefix="Catalog" title="Products sourced">
      <ul className={styles.prodList}>
        {supplier.products.map((p) => (
          <ProductRow key={p.productId} link={p} />
        ))}
      </ul>
    </Panel>
  );
}

function ProductRow({ link }: { link: LinkedProduct }): ReactNode {
  return (
    <li className={styles.prodRow}>
      <Link href={`/inventory/${link.productId}`} className={styles.prodMain}>
        <span className={styles.prodSku}>{link.sku ?? '—'}</span>
        <span className={styles.prodName}>{link.name ?? 'Unnamed product'}</span>
        {link.isPrimary ? <span className={styles.prodPrimary}>Primary</span> : null}
      </Link>
      <span className={styles.prodMeta}>
        <span className={styles.prodMetaItem}>
          <span className={styles.prodMetaLabel}>Cost</span>
          <StatNumber
            value={link.unitCost == null ? null : fmtMoney(link.unitCost)}
            unit="$"
            unitPosition="prefix"
          />
        </span>
        <span className={styles.prodMetaItem}>
          <span className={styles.prodMetaLabel}>Lead</span>
          <StatNumber value={link.leadTimeDays} unit="days" />
        </span>
        <span className={styles.prodMetaItem}>
          <span className={styles.prodMetaLabel}>MOQ</span>
          <StatNumber value={link.moq} />
        </span>
      </span>
    </li>
  );
}

function IdentityRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): ReactNode {
  return (
    <div className={styles.idRow}>
      <dt className={styles.idKey}>{label}</dt>
      <dd className={`${styles.idValue} ${mono ? styles.idValueMono : ''}`}>{value}</dd>
    </div>
  );
}

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
