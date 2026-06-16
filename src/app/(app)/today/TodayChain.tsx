'use client';

import Link from 'next/link';
import { type ReactNode, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import pageStyles from '@/components/bench/page.module.css';
import { ChainLink, type ChainState } from '@/components/ChainLink/ChainLink';
import { acknowledgeTopRecommendation } from './actions';
import styles from './today.module.css';

export interface ChainStepView {
  step: string;
  label: string;
  when?: string;
  state: ChainState;
  connector: 'cobalt' | 'pewter' | 'none';
}

interface TodayChainProps {
  steps: ChainStepView[];
  /** Index of the `active` link (the in-progress frontier). -1 if none. */
  activeIndex: number;
  /** Operator-facing PO reference, for the acknowledge copy. */
  reference: string;
  /** Link to the PO detail. */
  poHref: string;
  /** The most-pressing unacknowledged alert. null ⇒ nothing to acknowledge, so
   *  the chain rests (ignited, no heartbeat). */
  topAlertId: string | null;
  /** The plain-language thing the operator is acknowledging. */
  topAlertMemo: string | null;
}

/**
 * The dashboard centerpiece (Block 15): the most-pressing in-flight PO rendered
 * as the full visible chain. Its active link PULSES a cobalt heartbeat while a
 * recommendation is unacknowledged; the operator clicks "Acknowledge" and the
 * heartbeat stops, replaced by a steady flow-green dot. The dashboard's active
 * state is literally a heartbeat on the chain.
 */
export function TodayChain({
  steps,
  activeIndex,
  reference,
  poHref,
  topAlertId,
  topAlertMemo,
}: TodayChainProps): ReactNode {
  const [acked, setAcked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasPressing = topAlertId !== null;
  const pulsing = hasPressing && !acked;

  function acknowledge() {
    if (!topAlertId) return;
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeTopRecommendation(topAlertId);
      if (result.ok) {
        setAcked(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className={styles.centerpiece}>
      <div className={pageStyles.chain} data-pulsing={pulsing}>
        {steps.map((s, i) => (
          <ChainLink
            key={s.step}
            step={s.step}
            label={s.label}
            when={s.when}
            state={s.state}
            connector={s.connector}
            pulse={i === activeIndex && pulsing}
            settled={i === activeIndex && acked}
          />
        ))}
      </div>

      <div className={styles.centerpieceFoot}>
        <Link href={poHref} className={pageStyles.headerLink}>
          {reference} →
        </Link>

        {hasPressing ? (
          acked ? (
            <span className={styles.settledNote} role="status">
              <span className={styles.settledMark} aria-hidden="true" />
              Acknowledged — the bench is steady.
            </span>
          ) : (
            <ActionButton onClick={acknowledge} loading={pending}>
              Acknowledge today&rsquo;s recommendation
            </ActionButton>
          )
        ) : (
          <span className={styles.settledNote} role="status">
            <span className={styles.settledMark} aria-hidden="true" />
            Nothing needs your eye right now.
          </span>
        )}
      </div>

      {topAlertMemo && !acked ? <p className={styles.pressingMemo}>{topAlertMemo}</p> : null}
      {error ? (
        <p className={styles.ackError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
