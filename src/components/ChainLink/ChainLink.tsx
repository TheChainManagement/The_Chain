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
  /**
   * The terminal payoff: a `done` link that represents a just-completed order
   * (the RECEIVED link of a received PO) fills cobalt with the ignite sweep —
   * the "goods landed" moment — instead of the quiet corner dot. Visual only;
   * the link's logical state stays `done`.
   */
  celebrate?: boolean;
  /**
   * The dashboard heartbeat (Block 15). An `active` link pulses — a subtle 2s
   * cobalt opacity wave — to signal an unacknowledged recommendation needs the
   * operator's eye. Ignored on non-active links and once `settled`. Suppressed
   * under reduced-motion (the CSS guards it).
   */
  pulse?: boolean;
  /**
   * The acknowledged state of a pulsing active link: the heartbeat stops and a
   * small flow-green dot marks the link as seen. Visual only.
   */
  settled?: boolean;
}

export function ChainLink({
  step,
  label,
  when,
  state = 'pending',
  connector = 'none',
  celebrate = false,
  pulse = false,
  settled = false,
}: ChainLinkProps): ReactNode {
  const complete = celebrate && state === 'done';
  const pulsing = pulse && state === 'active' && !settled;
  const className = [
    styles.link,
    styles[state],
    complete ? styles.complete : '',
    pulsing ? styles.pulse : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      data-state={state}
      data-connector={connector}
      data-complete={complete}
      data-pulse={pulsing}
      data-settled={settled && state === 'active'}
    >
      {state === 'active' || complete ? (
        <span className={styles.ignite} aria-hidden="true" />
      ) : null}
      {pulsing ? <span className={styles.heartbeat} aria-hidden="true" /> : null}
      {settled && state === 'active' ? (
        <span className={styles.settledDot} aria-hidden="true" />
      ) : null}
      {state === 'done' && !complete ? (
        <span className={styles.cornerDot} aria-hidden="true" />
      ) : null}

      <span className={styles.step}>{step}</span>
      <span className={styles.label}>{label}</span>
      {when ? <span className={styles.when}>{when}</span> : null}
    </div>
  );
}
