import type { ReactNode } from 'react';
import styles from '@/app/(app)/bench.module.css';

/**
 * BenchAtmosphere — the two ambient motions of the bench, pure CSS (no JS):
 *   - Scroll progress: a 1px cobalt rule that scales from the left as the page
 *     scrolls, driven by CSS `animation-timeline: scroll()` (transform: scaleX).
 *   - Signal scan: a cobalt hairline that crosses the top once a minute.
 * Both degrade gracefully where scroll-timeline is unsupported. aria-hidden.
 */
export function BenchAtmosphere(): ReactNode {
  return (
    <>
      <div className={styles.progress} aria-hidden="true" />
      <div className={styles.signalScan} aria-hidden="true" />
    </>
  );
}
