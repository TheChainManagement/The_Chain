import type { ReactNode } from 'react';
import styles from './ClassificationBadge.module.css';

/**
 * ClassificationBadge — the canonical render path for a SKU's ABC·XYZ class.
 *
 * Two glyphs: ABC (value rank, weighted by ink intensity — A strong, C dim) and
 * XYZ (demand variability, by risk tone — X flow / Y warn / Z stop, because an
 * erratic SKU is the one that bites you). Plex Mono caps, semantic tints only;
 * cobalt is brand intent, never data (MASTER_PROMPT trust hierarchy).
 */

export interface ClassificationBadgeProps {
  abc: string | null | undefined;
  xyz: string | null | undefined;
  size?: 'sm' | 'md';
}

export function ClassificationBadge({
  abc,
  xyz,
  size = 'sm',
}: ClassificationBadgeProps): ReactNode {
  const a = normalize(abc, ['A', 'B', 'C']);
  const x = normalize(xyz, ['X', 'Y', 'Z']);

  if (!a && !x) {
    return <span className={`${styles.badge} ${styles[size]} ${styles.empty}`}>—</span>;
  }

  return (
    <span
      className={`${styles.badge} ${styles[size]}`}
      // A bare span doesn't support aria-label; img names the composite glyph.
      role="img"
      aria-label={`Class ${a ?? '—'} ${x ?? '—'}`}
    >
      <span className={a ? styles[`abc${a}`] : styles.empty}>{a ?? '—'}</span>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span className={x ? styles[`xyz${x}`] : styles.empty}>{x ?? '—'}</span>
    </span>
  );
}

function normalize(v: string | null | undefined, allowed: string[]): string | null {
  if (!v) return null;
  const u = v.toUpperCase();
  return allowed.includes(u) ? u : null;
}
