import type { ReactNode } from 'react';
import { StatNumber, type StatTone } from '../StatNumber/StatNumber';
import styles from './MetricCell.module.css';

/**
 * MetricCell — one cell in the metric strip. The strip uses border-divides, not
 * a card grid (MASTER_PROMPT bans the generic 3-column card archetype).
 *
 * Composes StatNumber for the value — the canonical statistical render path — so
 * every metric inherits Plex Mono tabular treatment for free. An optional delta
 * shows movement in a semantic tone (flow/stop/warn), never cobalt.
 */

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface MetricCellProps {
  /** Mono caps metric label, e.g. 'FILL RATE'. */
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  unitPosition?: 'prefix' | 'suffix';
  tone?: StatTone;
  /** Movement vs the prior period. */
  delta?: { value: string; direction: DeltaDirection };
  /** Semantic tone for the delta. Never cobalt. */
  deltaTone?: Extract<StatTone, 'flow' | 'warn' | 'stop' | 'mid'>;
  loading?: boolean;
  error?: boolean;
}

const ARROW: Record<DeltaDirection, string> = { up: '▲', down: '▼', flat: '→' };

export function MetricCell({
  label,
  value,
  unit,
  unitPosition,
  tone = 'deep',
  delta,
  deltaTone = 'mid',
  loading = false,
  error = false,
}: MetricCellProps): ReactNode {
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{label}</span>

      <StatNumber
        value={value}
        unit={unit}
        unitPosition={unitPosition}
        size="panel"
        tone={tone}
        loading={loading}
        error={error}
      />

      {delta && !loading && !error ? (
        <span className={[styles.delta, styles[`delta-${deltaTone}`]].join(' ')}>
          <span className={styles.arrow} aria-hidden="true">
            {ARROW[delta.direction]}
          </span>
          <span className={styles.deltaValue}>{delta.value}</span>
        </span>
      ) : null}
    </div>
  );
}
