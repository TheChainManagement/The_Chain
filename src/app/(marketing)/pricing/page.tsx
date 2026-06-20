import type { Metadata } from 'next';
import { StatNumber } from '@/components/StatNumber/StatNumber';
import { TrialCta } from '../TrialCta';
import styles from './pricing.module.css';

export const metadata: Metadata = {
  title: 'Pricing — The Chain',
  description:
    'Simple, value-based pricing for B2B distributors. 14-day free trial, no card to start. Starter, Growth, Pro, and Enterprise.',
};

interface Tier {
  key: string;
  name: string;
  price: number | 'custom';
  tagline: string;
  features: string[];
  retention: string;
  popular?: boolean;
}

const TIERS: Tier[] = [
  {
    key: 'starter',
    name: 'Starter',
    price: 129,
    tagline: 'A single location finding its footing.',
    features: [
      'QuickBooks Online sync',
      'Demand forecasting',
      'Reorder points + safety stock',
      'Supplier scorecards',
      'Up to 2 seats',
    ],
    retention: '1 year',
  },
  {
    key: 'growth',
    name: 'Growth',
    price: 299,
    tagline: 'Multi-location operators hitting their stride.',
    features: [
      'Everything in Starter',
      'Multiple locations',
      'Higher SKU + seat limits',
      'Sync conflict resolution',
      'In-app alerts',
    ],
    retention: '5 years',
    popular: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 599,
    tagline: 'Multi-entity operations and deep catalogs.',
    features: [
      'Everything in Growth',
      'Multi-entity',
      'Audit-log export',
      'Advanced analytics',
      'Priority support',
    ],
    retention: '10 years',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'custom',
    tagline: 'The largest operations, custom-fit.',
    features: [
      'Everything in Pro',
      'Unlimited history',
      'SSO + role controls',
      'Dedicated support',
      'Custom integrations',
    ],
    retention: 'Unlimited',
  },
];

/**
 * Pricing (Block 17b). Hairline-ruled tiers, no card boxes; prices in tabular
 * Plex Mono via <StatNumber>. Value-based bands that map to the retention tiers.
 * Every plan starts on the same 14-day trial.
 */
export default function Pricing() {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>Pricing</span>
        <h1 className={styles.h1}>Priced to pay for itself.</h1>
        <p className={styles.lede}>
          Fourteen-day free trial, no card to start. Priced by what you run — locations, SKUs,
          history — not per seat.
        </p>
      </header>

      <div className={styles.table}>
        {TIERS.map((t) => (
          <div
            key={t.key}
            className={styles.col}
            data-popular={t.popular ?? false}
            data-testid="tier"
          >
            {t.popular ? <span className={styles.tag}>Most popular</span> : null}
            <h2 className={styles.tierName}>{t.name}</h2>
            <div className={styles.price}>
              {t.price === 'custom' ? (
                <span className={styles.custom}>Custom</span>
              ) : (
                <>
                  <StatNumber value={t.price} unit="$" unitPosition="prefix" size="hero" />
                  <span className={styles.per}>/mo</span>
                </>
              )}
            </div>
            <p className={styles.tagline}>{t.tagline}</p>
            <TrialCta className={styles.tierCta} location={`pricing_${t.key}`}>
              Start 14-day trial
            </TrialCta>
            <ul className={styles.features}>
              {t.features.map((f) => (
                <li key={f} className={styles.feature}>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Retention compare-table: one scan across every plan's history window. */}
      <div className={styles.compare} data-testid="retention-compare">
        <span className={styles.compareLabel}>History retained</span>
        <div className={styles.compareRow}>
          {TIERS.map((t) => (
            <span key={t.key} className={styles.compareCell} data-popular={t.popular ?? false}>
              <span className={styles.compareTier}>{t.name}</span>
              <span className={styles.compareValue}>{t.retention}</span>
            </span>
          ))}
        </div>
      </div>

      <p className={styles.footnote}>
        Every plan runs the full product during your trial. Switch or cancel anytime. Enterprise
        pricing is set after a short conversation about your operation.
      </p>
    </div>
  );
}
