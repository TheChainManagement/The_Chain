import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import styles from './marketing.module.css';

/**
 * (marketing) segment — public surfaces. No bench, no rails. Top bar + footer
 * chrome only; shares tokens with the app, never the bench layout.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <ChainGlyph />
          The Chain
        </Link>
        <nav className={styles.topActions}>
          <Link href="/signin" className={styles.signin}>
            Sign in
          </Link>
          <Link href="/signup" className={styles.cta}>
            Get started
          </Link>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        THE CHAIN · A MORE TECHNOLOGIES PRODUCT · INVENTORY YOU CAN PROVE
      </footer>
    </div>
  );
}
