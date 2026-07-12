import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getRfqDetail } from '@/lib/procurement/queries';
import { createSupabaseServer } from '@/lib/supabase/server';
import { PrintButton } from './PrintButton';
import styles from './print.module.css';

export const metadata = { title: 'Request for quote · The Chain' };

/**
 * Per-vendor RFQ print sheet (W2-3 slice 2). Lives OUTSIDE the (app) segment so
 * it renders bare: no rails, no bench — a letterhead document the operator
 * prints or saves to PDF and emails to the vendor themselves (the
 * export-for-manual-send decision, design §7.2). Auth + RLS still apply.
 */
export default async function RfqPrintSheet({
  params,
}: {
  params: Promise<{ rfqId: string; supplierId: string }>;
}): Promise<ReactNode> {
  const { rfqId, supplierId } = await params;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/signin');
  }

  const rfq = await getRfqDetail(supabase, rfqId);
  const vendor = rfq?.vendors.find((v) => v.supplierId === supplierId);
  if (!rfq || !vendor) {
    notFound();
  }

  return (
    <main>
      <div className={styles.sheet}>
        <div className={styles.masthead}>
          <span className={styles.brand}>The Chain</span>
          <span className={styles.docKind}>Request for quote</span>
        </div>

        <h1 className={styles.title}>{rfq.title}</h1>

        <div className={styles.grid}>
          <div>
            <span className={styles.k}>Vendor</span>
            <span className={styles.v}>{vendor.supplierName}</span>
          </div>
          <div>
            <span className={styles.k}>Deliver to</span>
            <span className={styles.v}>{rfq.locationName}</span>
          </div>
          <div>
            <span className={styles.k}>Respond by</span>
            <span className={styles.v}>{rfq.respondBy ?? 'At your earliest convenience'}</span>
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>SKU</th>
              <th>Product</th>
              <th className={styles.num}>Quantity</th>
              <th>Unit</th>
              <th>Note</th>
              <th>Your unit price</th>
              <th>Your lead time</th>
            </tr>
          </thead>
          <tbody>
            {rfq.lines.map((l) => (
              <tr key={l.lineNo}>
                <td>{l.lineNo}</td>
                <td>{l.sku}</td>
                <td>{l.productName}</td>
                <td className={styles.num}>{l.qty}</td>
                <td>{l.stockUom ?? 'each'}</td>
                <td>{l.note ?? ''}</td>
                <td>
                  <span className={styles.blank}>&nbsp;</span>
                </td>
                <td>
                  <span className={styles.blank}>&nbsp;</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className={styles.footer}>
          Please quote unit prices in your selling unit and note the unit on your reply. Reply to
          the sender of this sheet.
        </p>
      </div>

      <div className={styles.printBar}>
        <PrintButton />
      </div>
    </main>
  );
}
