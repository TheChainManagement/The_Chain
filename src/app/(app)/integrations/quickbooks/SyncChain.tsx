import type { ReactNode } from 'react';
import { ChainLink, type ChainState } from '@/components/ChainLink/ChainLink';
import styles from '../integrations.module.css';

/**
 * SyncChain — the memorable element of the QBO connect screen (FEATURES.md
 * Block 6). As the first sync runs, the operator watches their QuickBooks state
 * become a visible chain: the SUPPLIERS link forms as vendors arrive, ORDERED as
 * POs arrive, IN TRANSIT if any PO is still open. Each link ignites cobalt on
 * mount (the Chain's signature motion, owned by `ChainLink`).
 *
 * Presentational only — `ConnectPanel` drives the link states through the reveal.
 */

export interface SyncLink {
  step: string;
  label: string;
  when?: string;
  state: ChainState;
}

/** A done link connects cobalt to the next; an unformed link stays pewter. */
function connectorFor(state: ChainState, isLast: boolean): 'cobalt' | 'pewter' | 'none' {
  if (isLast) return 'none';
  return state === 'done' ? 'cobalt' : 'pewter';
}

export function SyncChain({ links }: { links: SyncLink[] }): ReactNode {
  return (
    <ul className={styles.syncChain} aria-label="QuickBooks sync chain">
      {links.map((link, i) => (
        <li className={styles.syncChainCell} key={link.step}>
          <ChainLink
            step={link.step}
            label={link.label}
            when={link.when}
            state={link.state}
            connector={connectorFor(link.state, i === links.length - 1)}
          />
        </li>
      ))}
    </ul>
  );
}
