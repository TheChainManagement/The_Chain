import type { ReactNode } from 'react';
import styles from './Panel.module.css';

/**
 * Panel — the flat work surface that replaces "cards".
 *
 * White surface, 1px hairline border, sharp corners, a 6px blueprint corner-cut
 * at the top-right. No drop shadow on idle (MASTER_PROMPT bans idle card
 * shadows); a focused panel gets a single inner shadow at the top-left. Empty
 * zones carry the dotted engineering lattice. States: loading / error / empty.
 */

export interface PanelProps {
  /** Panel heading (Mona Sans). */
  title?: string;
  /** Mono caps eyebrow above the title. */
  prefix?: string;
  /** Header-right slot, e.g. an ActionButton. */
  actions?: ReactNode;
  children?: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  /** Active/selected panel — single inner shadow at top-left. */
  focused?: boolean;
}

export function Panel({
  title,
  prefix,
  actions,
  children,
  empty = false,
  emptyMessage = 'Nothing here yet.',
  loading = false,
  error = false,
  errorMessage = 'Something went wrong loading this panel.',
  focused = false,
}: PanelProps): ReactNode {
  const hasHeader = Boolean(title || prefix || actions);
  const className = [styles.panel, focused ? styles.focused : ''].join(' ').trim();

  return (
    <section className={className} aria-busy={loading || undefined}>
      <span className={styles.cut} aria-hidden="true" />

      {hasHeader ? (
        <header className={styles.header}>
          <span className={styles.heading}>
            {prefix ? <span className={styles.prefix}>{prefix}</span> : null}
            {title ? <h3 className={styles.title}>{title}</h3> : null}
          </span>
          {actions ? <span className={styles.actions}>{actions}</span> : null}
        </header>
      ) : null}

      {loading ? (
        <div className={styles.skeleton} data-testid="panel-loading" aria-hidden="true">
          <span className={styles.skelLine} />
          <span className={styles.skelLine} />
          <span className={styles.skelLineShort} />
        </div>
      ) : error ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : empty ? (
        <div className={styles.empty} data-testid="panel-empty">
          <span className={styles.lattice} aria-hidden="true" />
          <p className={styles.emptyMessage}>{emptyMessage}</p>
        </div>
      ) : (
        <div className={styles.body}>{children}</div>
      )}
    </section>
  );
}
