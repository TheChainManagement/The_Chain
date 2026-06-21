import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChainGlyph } from '@/components/brand/ChainGlyph';
import { GetStartedCta } from './GetStartedCta';
import { MarketingChrome } from './MarketingChrome';
import styles from './marketing.module.css';

/**
 * (marketing) segment — public surfaces. No bench, no rails, no app chrome.
 * Editorial top bar + footer only; shares design tokens with the app, never the
 * bench layout (acceptance: no left-rail / right-rail / bench-after on any
 * marketing page). Nav section links land as their pages ship (17b/17c); 17a
 * keeps only working links so nothing dead-ends.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <MarketingChrome />

      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <ChainGlyph />
          The Chain
        </Link>
        <nav className={styles.topActions} aria-label="Primary">
          <Link href="/how-it-works" className={styles.navLink}>
            How it works
          </Link>
          <Link href="/pricing" className={styles.navLink}>
            Pricing
          </Link>
          <Link href="/signin" className={styles.signin}>
            Sign in
          </Link>
          <GetStartedCta className={styles.cta} location="nav">
            Get started
          </GetStartedCta>
        </nav>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <span className={styles.footBrand}>The Chain</span>
        <nav className={styles.footLinks} aria-label="Footer">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <span className={styles.footMeta}>© 2026 More Technologies</span>
      </footer>
    </div>
  );
}
