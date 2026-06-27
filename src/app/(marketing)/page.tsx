import type { Metadata } from 'next';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import { GetStartedCta } from './GetStartedCta';
import { HeroScrubber } from './HeroScrubber';
import styles from './marketing.module.css';

export const metadata: Metadata = {
  title: 'The Chain — Everything is connected.',
  description:
    'AI-driven supply chain for small-to-mid B2B distributors on QuickBooks. Supplier to shelf, every link in your inventory moves as one chain you can see. Stop guessing reorders — start proving them.',
  openGraph: {
    title: 'The Chain — Everything is connected.',
    description:
      'Forecast-driven reordering for QuickBooks distributors. See the whole chain, supplier to shelf.',
    siteName: 'The Chain',
    type: 'website',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'The Chain',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'AI-driven supply chain for small-to-mid B2B distributors on QuickBooks: demand forecasting, defensible reorder points, supplier scorecards, and a visible PO chain.',
  offers: { '@type': 'Offer', price: '129', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'More Technologies' },
};

// Safe JSON-LD: rendered as string children (never raw HTML injection), with `<`
// escaped so the payload can't close the script tag early. Static data, no input.
const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

// The hero PO chain — the product metaphor, alive in the hero. Demand and
// Forecast are done (slate, cobalt corner dot); the PO link is active and
// IGNITES cobalt on load; Supplier and Received wait. The notched-link grammar
// is shared with the product app and threaded through the whole marketing site.
const CHAIN = [
  { step: 'DEMAND', state: 'done' },
  { step: 'FORECAST', state: 'done' },
  { step: 'PO', state: 'active' },
  { step: 'SUPPLIER', state: 'pending' },
  { step: 'RECEIVED', state: 'pending' },
] as const;

/**
 * Marketing home. Premium re-cut (build-beautiful, 2026-06-21): the isometric
 * supply-chain model is composited onto the drafting-paper bench with
 * mix-blend-mode so it reads as printed there, not pasted in a box; a faint
 * rotated engineering blueprint sits underneath as the working print. The
 * headline stamps in on the Mona Sans width axis; the live PO chain ignites
 * cobalt at the PO link, and a cobalt vector points from there into the model's
 * lit chain. The chain is the product, the navigation, and the conversion logic.
 */
export default function MarketingHome() {
  return (
    <div className={styles.home}>
      <script type="application/ld+json">{jsonLdText}</script>

      <section className={styles.hero} aria-labelledby="hero-headline">
        {/* Composited visual field — blueprint underlay + isometric model. */}
        <div className={styles.stage} aria-hidden="true">
          <div className={styles.blueprintUnder} data-testid="hero-bg" />
          <Image
            src="/marketing/hero-chain.jpg"
            alt=""
            width={1600}
            height={900}
            priority
            className={styles.isoRender}
          />
          <span className={styles.vector} />
          <HeroScrubber />
        </div>

        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.liveDot} />
            For B2B distributors on QuickBooks
          </span>
          <h1 id="hero-headline" className={styles.h1}>
            <span className={styles.h1line}>Everything</span>{' '}
            <span className={styles.h1line}>is connected.</span>
          </h1>
          <p className={styles.lede}>
            Supplier to shelf, every link in your inventory moves as one chain you can see. Stop
            guessing reorders — start proving them.
          </p>

          <div
            className={styles.heroChain}
            role="img"
            aria-label="A purchase order advancing through the chain: demand, forecast, PO, supplier, received."
          >
            {CHAIN.map((link, i) => (
              <span
                key={link.step}
                className={styles.chainLink}
                data-state={link.state}
                data-last={i === CHAIN.length - 1 ? '' : undefined}
                style={{ '--i': i } as CSSProperties}
              >
                {link.state === 'active' ? <span className={styles.ignite} /> : null}
                {link.state === 'done' ? <span className={styles.dot} /> : null}
                <span className={styles.chainStep}>{link.step}</span>
              </span>
            ))}
          </div>

          <div className={styles.heroActions}>
            <GetStartedCta className={styles.ctaPrimary} location="hero">
              Get started
            </GetStartedCta>
            <a href="/how-it-works" className={styles.ctaSecondary}>
              See how it works
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
