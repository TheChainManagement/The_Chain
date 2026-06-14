'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { ClaudeInsight } from '@/components/ClaudeInsight/ClaudeInsight';
import { loadWeeklyChangeInsight } from '@/lib/insights/actions';
import type { InsightView } from '@/lib/insights/generate';
import styles from './InsightPanel.module.css';

/**
 * "What changed this week" digest panel (Block 12 Wave B2). Tenant-level — lazily
 * loads the cached weekly note on first view of the Flow hub and renders it
 * through the canonical `<ClaudeInsight>`. The digest reads from exact operational
 * counts (alerts, reorder flags, receipts, conflicts); the panel never shows a
 * number that isn't already on the surfaces below it.
 */
export function WeeklyChangeInsightPanel(): ReactNode {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; insight: InsightView }
  >({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    loadWeeklyChangeInsight().then((res) => {
      if (!active) return;
      setState(res.ok ? { phase: 'ready', insight: res.insight } : { phase: 'error' });
    });
    return () => {
      active = false;
    };
  }, []);

  if (state.phase === 'loading') return <ClaudeInsight topic="what changed this week" loading />;
  if (state.phase === 'error') return <ClaudeInsight topic="what changed this week" error />;

  const { insight } = state;

  return (
    <div className={styles.wrap}>
      <ClaudeInsight topic="what changed this week" confidence={insight.confidence}>
        {insight.content}
      </ClaudeInsight>
      <span className={styles.caption}>
        {insight.model} · prompt {insight.promptVersion}
        {insight.cached ? ' · cached' : ''}
      </span>
    </div>
  );
}
