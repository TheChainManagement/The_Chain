import type { ReactNode } from 'react';
import styles from './bench-rails.module.css';

/**
 * RightRail — the contextual column. Inset pewter, narrower than the left rail
 * (asymmetry by design). At 5H it holds the standing context + where Claude's
 * interpretation will live once features land. Hidden on mobile.
 */
export function RightRail({ children }: { children?: ReactNode }): ReactNode {
  return (
    <aside className={styles.right} aria-label="Context">
      {children ?? (
        <>
          <span className={styles.railLabel}>Context</span>
          <p className={styles.railNote}>
            This rail carries the why behind the numbers. As you connect a source and the chain
            fills, Claude’s read on each recommendation surfaces here.
          </p>
        </>
      )}
    </aside>
  );
}
