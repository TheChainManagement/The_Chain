import type { ReactNode } from 'react';
import type { DayBucket } from '@/lib/dashboard/transform';
import styles from './today.module.css';

/**
 * Throughput ruler (Block 15) — a hairline with seven day ticks, the last 7
 * days of PO completions typeset as small chips along it, and a cobalt today
 * marker. The bench's pulse over the week, read at a glance. No card box; just
 * the rule, the ticks, and the counts.
 */
export function ThroughputRuler({ buckets }: { buckets: DayBucket[] }): ReactNode {
  const total = buckets.reduce((n, b) => n + b.count, 0);

  return (
    <div className={styles.ruler}>
      <div className={styles.rulerLine} aria-hidden="true" />
      <ol
        className={styles.rulerDays}
        aria-label={`${total} purchase orders completed in the last 7 days`}
      >
        {buckets.map((b) => (
          <li
            key={b.dayIso}
            className={styles.rulerDay}
            data-today={b.isToday}
            data-has={b.count > 0}
          >
            <span className={styles.rulerTick} aria-hidden="true" />
            <span className={styles.rulerCount}>{b.count > 0 ? b.count : '·'}</span>
            <span className={styles.rulerLabel}>{b.isToday ? 'Today' : b.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
