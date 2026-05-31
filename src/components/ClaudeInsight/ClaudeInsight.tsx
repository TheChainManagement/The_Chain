import type { ReactNode } from 'react';
import styles from './ClaudeInsight.module.css';

/**
 * ClaudeInsight — the ONE canonical render path for AI explanation.
 *
 * Trust hierarchy (MASTER_PROMPT): Claude's interpretation renders in IBM Plex
 * Sans body with a tiny IBM Plex Mono "Claude · {topic}" prefix label, visually
 * distinct from statistical output (StatNumber) and from user actions
 * (ActionButton). Claude NEVER renders as a number. Confidence, when shown, is a
 * hairline track with a deep-slate tick — never a cobalt fill (cobalt is brand
 * intent, not data).
 */

export interface ClaudeInsightProps {
  /** Short topic shown in the mono prefix, e.g. 'reorder', 'forecast'. */
  topic: string;
  /** The interpretation prose. */
  children?: ReactNode;
  /** 0..1 model confidence. Rendered as a hairline track + deep-slate tick. */
  confidence?: number;
  loading?: boolean;
  error?: boolean;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function ClaudeInsight({
  topic,
  children,
  confidence,
  loading = false,
  error = false,
}: ClaudeInsightProps): ReactNode {
  const hasConfidence = typeof confidence === 'number' && !loading && !error;
  const pct = hasConfidence ? Math.round(clamp01(confidence as number) * 100) : 0;

  return (
    <aside className={styles.insight}>
      <span className={styles.prefix}>
        <span className={styles.mark}>Claude</span>
        <span className={styles.sep}>·</span>
        <span className={styles.topic}>{topic}</span>
      </span>

      {loading ? (
        <span className={styles.skeleton} aria-hidden="true" data-testid="insight-loading">
          <span className={styles.line} />
          <span className={styles.line} />
          <span className={styles.lineShort} />
        </span>
      ) : error ? (
        <p className={styles.error} role="status">
          Couldn’t generate an explanation. The numbers above still stand on their own.
        </p>
      ) : children ? (
        <div className={styles.prose}>{children}</div>
      ) : (
        <p className={styles.empty}>No interpretation yet.</p>
      )}

      {hasConfidence ? (
        <span className={styles.confidence} data-testid="insight-confidence">
          <span className={styles.confLabel}>CONFIDENCE</span>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.tick} style={{ left: `${pct}%` }} />
          </span>
          <span className={styles.confValue}>{pct}%</span>
        </span>
      ) : null}
    </aside>
  );
}
