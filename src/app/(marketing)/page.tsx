import type { Metadata } from 'next';
import styles from './marketing.module.css';
import { TrialCta } from './TrialCta';

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

// Safe JSON-LD: string children (not dangerouslySetInnerHTML), `<` escaped so the
// payload can never close the script tag early. Static data, no user input.
const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

/**
 * Marketing home (Block 17a). A clean, confident opening: the slogan, the why,
 * the CTA — left-aligned over a faded engineering blueprint so the page reads as
 * light-engineered, never a flat white screen. The hero visual is intentionally
 * deferred ("work on this further down"); this is the uncluttered first pass.
 */
export default function MarketingHome() {
  return (
    <div className={styles.home}>
      <script type="application/ld+json">{jsonLdText}</script>
      <div className={styles.heroBg} aria-hidden="true" data-testid="hero-bg" />

      <section className={styles.hero} aria-labelledby="hero-headline">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            For B2B distributors on QuickBooks
          </span>
          <h1 id="hero-headline" className={styles.h1}>
            Everything is connected.
          </h1>
          <p className={styles.lede}>
            Supplier to shelf, every link in your inventory moves as one chain you can see. Stop
            guessing reorders — start proving them.
          </p>
          <div className={styles.heroActions}>
            <TrialCta className={styles.ctaPrimary} location="hero">
              Start 14-day trial
            </TrialCta>
            <a href="/signin" className={styles.ctaSecondary}>
              Sign in
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
