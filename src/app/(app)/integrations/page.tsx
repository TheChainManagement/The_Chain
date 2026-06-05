import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/bench/PageHeader';
import pageStyles from '@/components/bench/page.module.css';
import styles from './integrations.module.css';

export const metadata = { title: 'Integrations · The Chain' };

/**
 * Integrations index — the source connectors. QuickBooks Online is the Wave 1
 * native two-way anchor; CSV is the universal fallback (Block 5). Future
 * aggregators (Rutter) and per-ERP natives arrive in later waves and show here
 * muted until they ship.
 */

interface Source {
  mark: string;
  name: string;
  blurb: string;
  tags: string[];
  href?: string;
  cta?: string;
  note?: string;
}

const SOURCES: Source[] = [
  {
    mark: 'qb',
    name: 'QuickBooks Online',
    blurb:
      'Native two-way sync. Reads items, vendors, purchase orders, bills, and sales; writes generated POs back.',
    tags: ['two-way', 'items', 'vendors', 'sales', 'PO write-back'],
    href: '/integrations/quickbooks',
    cta: 'Set up QuickBooks →',
  },
  {
    mark: 'csv',
    name: 'CSV import',
    blurb:
      'Universal fallback. Upload products, suppliers, and sales/movements with drag-to-map columns.',
    tags: ['products', 'suppliers', 'movements'],
    href: '/import',
    cta: 'Open importer →',
  },
  {
    mark: 'rt',
    name: 'Rutter',
    blurb:
      'One connection, many systems (NetSuite, Sage Intacct, Xero, Shopify, Square, and more). Arrives in a later wave.',
    tags: ['aggregator', 'wave 5'],
    note: 'Coming in a later wave',
  },
];

export default function IntegrationsPage(): ReactNode {
  return (
    <div className={pageStyles.stack}>
      <PageHeader eyebrow="Ingestion · connect your systems" title="Integrations" />
      <div className={styles.grid}>
        {SOURCES.map((source) => {
          const muted = !source.href;
          return (
            <div
              key={source.name}
              className={
                muted ? `${styles.sourceCard} ${styles.sourceCardMuted}` : styles.sourceCard
              }
            >
              <span className={styles.sourceMark} aria-hidden="true">
                {source.mark}
              </span>
              <h2 className={styles.sourceName}>{source.name}</h2>
              <p className={styles.sourceBlurb}>{source.blurb}</p>
              <div className={styles.tags}>
                {source.tags.map((tag) => (
                  <span className={styles.tag} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              {source.href ? (
                <Link href={source.href} className={styles.sourceCta}>
                  {source.cta}
                </Link>
              ) : (
                <span className={styles.sourceMutedNote}>{source.note}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
