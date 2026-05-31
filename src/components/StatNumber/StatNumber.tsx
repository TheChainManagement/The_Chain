import type { ReactNode } from 'react';
import styles from './StatNumber.module.css';

/**
 * StatNumber — the ONE canonical render path for statistical model output.
 *
 * Trust hierarchy (MASTER_PROMPT): every consequential number renders here, in
 * IBM Plex Mono with tabular numerics on deep slate. Phase 6 lint greps for
 * inline number rendering; this component is the only sanctioned path.
 *
 * Tone is semantic but NEVER cobalt — cobalt is brand intent, not data. A number
 * that is "good/on-time" may use `flow`; a stockout may use `stop`. Default deep.
 */

export type StatTone = 'deep' | 'mid' | 'flow' | 'warn' | 'stop';
export type StatSize = 'body' | 'panel' | 'hero';

export interface StatNumberProps {
  /** The statistical value. Caller controls precision — we never round. */
  value: number | string | null | undefined;
  /** Unit glyph, e.g. '%', 'days'. Rendered smaller, dim. */
  unit?: string;
  /** Where the unit sits. '$' is a prefix; '%' / 'days' are suffixes. */
  unitPosition?: 'prefix' | 'suffix';
  size?: StatSize;
  tone?: StatTone;
  /** Async surface is still resolving — show a shimmer placeholder. */
  loading?: boolean;
  /** The value could not be computed — show a stop-red marker. */
  error?: boolean;
  /** Optional mono caps label above the number. */
  label?: string;
  /** Accessible description when the number alone is ambiguous. */
  'aria-label'?: string;
}

const EM_DASH = '—';

export function StatNumber({
  value,
  unit,
  unitPosition = 'suffix',
  size = 'body',
  tone = 'deep',
  loading = false,
  error = false,
  label,
  'aria-label': ariaLabel,
}: StatNumberProps): ReactNode {
  const root = [styles.stat, styles[size], styles[`tone-${tone}`]].join(' ');

  const body = (() => {
    if (loading) {
      return <span className={styles.shimmer} aria-hidden="true" data-testid="stat-loading" />;
    }
    if (error) {
      return (
        <span className={styles.error} role="img" aria-label={ariaLabel ?? 'unavailable'}>
          {EM_DASH}
        </span>
      );
    }
    const isEmpty = value === null || value === undefined || value === '';
    if (isEmpty) {
      return (
        <span className={styles.empty} role="img" aria-label={ariaLabel ?? 'no value'}>
          {EM_DASH}
        </span>
      );
    }
    // The number is visible text and reads correctly to a screen reader as-is;
    // ariaLabel only overrides the meaningless empty/error markers above.
    return (
      <span className={styles.value}>
        {unit && unitPosition === 'prefix' ? <span className={styles.unit}>{unit}</span> : null}
        <span className={styles.digits}>{value}</span>
        {unit && unitPosition === 'suffix' ? <span className={styles.unit}>{unit}</span> : null}
      </span>
    );
  })();

  return (
    <span className={root}>
      {label ? <span className={styles.label}>{label}</span> : null}
      {body}
    </span>
  );
}
