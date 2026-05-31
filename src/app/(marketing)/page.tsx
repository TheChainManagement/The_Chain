import Link from 'next/link';
import { ChainLink } from '@/components/ChainLink/ChainLink';
import styles from './marketing.module.css';

export const metadata = {
  title: 'The Chain — Inventory you can prove. Reorders you can defend.',
};

export default function MarketingHome() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>For small-to-mid B2B distributors</span>
        <h1 className={styles.h1}>Inventory you can prove. Reorders you can defend.</h1>
        <p className={styles.lede}>
          Connect QuickBooks Online and The Chain reads your catalog, suppliers, and purchase
          history, then watches every PO advance link by link. Statistical forecasts, defensible
          reorder points, and supplier scorecards. Stop running stock on instinct.
        </p>
        <div className={styles.heroActions}>
          <Link href="/signup" className={styles.cta}>
            Create your workshop
          </Link>
          <Link href="/signin" className={styles.signin}>
            Sign in
          </Link>
        </div>
      </div>

      <aside className={styles.heroAside}>
        <span className={styles.asideLabel}>PO-4471 · Calhoun Foods</span>
        <ChainLink
          step="SUPPLIER"
          label="Atchafalaya Distributing"
          when="Apr 14 · 08:10"
          state="done"
        />
        <ChainLink step="ORDERED" label="142 units" when="Apr 14 · 16:42" state="done" />
        <ChainLink step="IN TRANSIT" label="3 pallets" when="Apr 18 · 09:24" state="active" />
        <ChainLink step="RECEIVED" label="Awaiting dock" state="pending" />
        <ChainLink step="ON HAND" label="Not yet" state="pending" />
      </aside>
    </section>
  );
}
