'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { loadReorderInsight } from '@/lib/insights/actions';
import type { InsightView } from '@/lib/insights/generate';
import styles from './InsightPanel.module.css';

const LOW_CONFIDENCE = 0.6;

/**
 * "Why this reorder" panel (Block 12). Lazily loads the cached insight on first
 * view and renders it through the canonical `<ClaudeInsight>` (loading → prose →
 * confidence). Adds the two contract requirements: the cited model +
 * prompt_version caption, and an explicit low-confidence / sparse-data warning.
 * The panel NEVER renders a number that isn't already in the statistical view.
 */
export function ReorderInsightPanel({ poId }: { poId: string }): ReactNode {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; insight: InsightView }
  >({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    loadReorderInsight(poId).then((res) => {
      if (!active) return;
      setState(res.ok ? { phase: 'ready', insight: res.insight } : { phase: 'error' });
    });
    return () => {
      active = false;
    };
  }, [poId]);

  if (state.phase === 'loading') return <ClaudeInsight topic="why this reorder" loading />;
  if (state.phase === 'error') return <ClaudeInsight topic="why this reorder" error />;

  const { insight } = state;
  const lowConfidence = insight.confidence < LOW_CONFIDENCE;

  return (
    <div className={styles.wrap}>
      <ClaudeInsight topic="why this reorder" confidence={insight.confidence}>
        {insight.content}
        {lowConfidence ? (
          <span className={styles.warning}>
            Limited history — treat this read as more variable than usual.
          </span>
        ) : null}
      </ClaudeInsight>
      <span className={styles.caption}>
        {insight.model} · prompt {insight.promptVersion}
        {insight.cached ? ' · cached' : ''}
      </span>
    </div>
  );
}
