'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { loadForecastInsight } from '@/lib/insights/actions';
import type { InsightView } from '@/lib/insights/generate';
import styles from './InsightPanel.module.css';

const LOW_CONFIDENCE = 0.6;

/**
 * "Why this forecast" panel (Block 12 Wave B). Lazily loads the cached insight
 * on first view of a SKU's forecast and renders it through the canonical
 * `<ClaudeInsight>` (loading → prose → confidence) with the cited model +
 * prompt_version caption and an explicit low-confidence / benchmark-fill
 * warning. The panel NEVER renders a number that isn't already on the chart.
 */
export function ForecastInsightPanel({ productId }: { productId: string }): ReactNode {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; insight: InsightView }
  >({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    loadForecastInsight(productId).then((res) => {
      if (!active) return;
      setState(res.ok ? { phase: 'ready', insight: res.insight } : { phase: 'error' });
    });
    return () => {
      active = false;
    };
  }, [productId]);

  if (state.phase === 'loading') return <ClaudeInsight topic="why this forecast" loading />;
  if (state.phase === 'error') return <ClaudeInsight topic="why this forecast" error />;

  const { insight } = state;
  const lowConfidence = insight.confidence < LOW_CONFIDENCE;

  return (
    <div className={styles.wrap}>
      <ClaudeInsight topic="why this forecast" confidence={insight.confidence}>
        {insight.content}
        {lowConfidence ? (
          <span className={styles.warning}>
            Thin backtest — treat this read as more variable than usual.
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
