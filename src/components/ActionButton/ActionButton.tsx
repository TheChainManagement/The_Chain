'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './ActionButton.module.css';

/**
 * ActionButton — the ONE canonical render path for a user action.
 *
 * Trust hierarchy (MASTER_PROMPT): primary actions are cobalt CTAs carrying
 * `--shadow-cobalt-inner` (inner refraction) + `--shadow-cobalt-diffusion`
 * (outer tint). Cobalt-on-cobalt focus rings disappear, so focus-visible is a
 * deep-slate ring (handled in CSS). Secondary actions are deep-slate text links
 * with a hairline underline that scales from the left on hover. Never a neon
 * glow; active state is a 1px Y translate.
 *
 * Client component because it owns click + the loading affordance.
 */

export interface ActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  /** In-flight: disables interaction and shows a pulsing tick. */
  loading?: boolean;
}

export function ActionButton({
  children,
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  ...rest
}: ActionButtonProps): ReactNode {
  const isDisabled = disabled || loading;
  const className = [styles.btn, styles[variant], loading ? styles.isLoading : ''].join(' ').trim();

  return (
    <button
      type={type}
      className={className}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className={styles.tick} aria-hidden="true" data-testid="button-loading" />
      ) : null}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
