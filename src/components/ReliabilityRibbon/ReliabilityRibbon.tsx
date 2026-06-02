import type { CSSProperties, ReactNode } from 'react';
import type { ReliabilityState, ReliabilityTile } from '@/lib/suppliers/transform';
import styles from './ReliabilityRibbon.module.css';

/**
 * ReliabilityRibbon — a supplier's reputation, read in one glance. The chain
 * motif scaled down to a row of delivery tiles (the last N POs, newest first):
 * cobalt for on-time-in-full, amber for short, stop-red for late, and dim
 * placeholders for POs not yet delivered. Cobalt here is the single Chain intent
 * slot for the supplier surface (the ribbon IS the chain), not a separate slot.
 *
 * The memorable element of Block 4 (FEATURES.md). Renders its full shape even
 * with zero history, so a brand-new supplier still shows the ribbon it will earn.
 */

const STATE_LABEL: Record<ReliabilityState, string> = {
  otif: 'On time, in full',
  short: 'Delivered short',
  late: 'Delivered late',
  pending: 'No delivery yet',
};

export function ReliabilityRibbon({ tiles }: { tiles: ReliabilityTile[] }): ReactNode {
  const delivered = tiles.filter((t) => t.state !== 'pending').length;

  return (
    <div className={styles.wrap}>
      <div
        className={styles.ribbon}
        role="img"
        aria-label={
          delivered === 0
            ? 'No delivery history yet'
            : `${delivered} of the last ${tiles.length} purchase orders shown`
        }
      >
        {tiles.map((t, i) => (
          <span
            // Position in the fixed-width ribbon is the identity here; tiles have
            // no stable id and the order is meaningful (newest first).
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-width positional ribbon
            key={i}
            className={`${styles.tile} ${styles[t.state]}`}
            style={{ '--tile-index': i } as CSSProperties}
            title={t.when ? `${STATE_LABEL[t.state]} · ${t.when}` : STATE_LABEL[t.state]}
          />
        ))}
      </div>
      <span className={styles.caption}>
        {delivered === 0
          ? 'No delivery history yet'
          : `Last ${tiles.length} deliveries — newest first`}
      </span>
    </div>
  );
}
