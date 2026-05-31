import type { ReactNode } from 'react';
import styles from './ChainLink.module.css';

/**
 * ChainLink — one link in the visible PO chain, the product's signature object.
 *
 * The chain is how an operator watches a purchase order advance link by link.
 * The memorable moment: an `active` link IGNITES — cobalt fills in from the left
 * with spring physics on mount (the chain's signature motion). `done` links are
 * inset pewter with a cobalt corner dot; `pending` links wait in white.
 *
 * Cobalt on the active link is the single Chain intent slot (MASTER_PROMPT),
 * not a separate cobalt allotment. Connectors are part of that same slot.
 */

export type ChainState = 'done' | 'active' | 'pending';

export interface ChainLinkProps {
  /** Mono caps step label, e.g. 'SUPPLIER', 'IN TRANSIT'. */
  step: string;
  /** Plex Sans heading, e.g. 'Atchafalaya Distributing'. */
  label: string;
  /** Plex Mono timestamp, e.g. 'Apr 18 · 09:24'. */
  when?: string;
  state?: ChainState;
  /** Connector hairline to the next link. Omit on the last link. */
  connector?: 'cobalt' | 'pewter' | 'none';
}

export function ChainLink({
  step,
  label,
  when,
  state = 'pending',
  connector = 'none',
}: ChainLinkProps): ReactNode {
  const className = [styles.link, styles[state]].join(' ');

  return (
    <div className={className} data-state={state} data-connector={connector}>
      {state === 'active' ? <span className={styles.ignite} aria-hidden="true" /> : null}
      {state === 'done' ? <span className={styles.cornerDot} aria-hidden="true" /> : null}

      <span className={styles.step}>{step}</span>
      <span className={styles.label}>{label}</span>
      {when ? <span className={styles.when}>{when}</span> : null}
    </div>
  );
}
