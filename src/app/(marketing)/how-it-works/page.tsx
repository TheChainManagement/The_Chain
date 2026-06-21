import type { Metadata } from 'next';
import { GetStartedCta } from '../GetStartedCta';
import { GuidedFlow } from './GuidedFlow';
import styles from './how-it-works.module.css';

export const metadata: Metadata = {
  title: 'How it works — The Chain',
  description:
    'Four links, one chain. Connect QuickBooks, see a real forecast, reorder with proof, and close the loop on every PO.',
};

/**
 * How it works (Block 17b, premium re-cut 2026-06-21). A guided blueprint
 * workbench: the four stages scroll in the center, a sticky supply-chain model
 * re-crops to the stage in view, and a cobalt chain rail advances its lit link.
 * Replaces the type-only sticky stack that read as dead whitespace.
 */
export default function HowItWorks() {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>How it works</span>
        <h1 className={styles.h1}>Four links. One chain.</h1>
        <p className={styles.lede}>
          From the supplier to your shelf, The Chain runs one connected loop — and every trip around
          it makes the next one sharper. Scroll to walk the chain.
        </p>
      </header>

      <GuidedFlow />

      <div className={styles.cta}>
        <GetStartedCta className={styles.ctaPrimary} location="how_it_works">
          Get started
        </GetStartedCta>
        <a href="/pricing" className={styles.ctaSecondary}>
          See pricing →
        </a>
      </div>
    </div>
  );
}
