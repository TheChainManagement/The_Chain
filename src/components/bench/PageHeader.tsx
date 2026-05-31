import type { ReactNode } from 'react';
import styles from './page.module.css';

/**
 * PageHeader — the consistent top of every bench surface. Mono eyebrow + Mona
 * Sans title + optional right-side actions slot.
 */
export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.headingGroup}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
