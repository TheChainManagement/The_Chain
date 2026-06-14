// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InsightView } from '@/lib/insights/generate';

/**
 * Memorable-artifact guard for the AI insights layer (Block 12). The memorable
 * element: a "Claude · why this reorder" panel on the PO detail page — an
 * operator's whiteboard note in plain English, with the cited model +
 * prompt_version. Paired with the live browser capture in
 * `_reviews/2026-06-14_block12_ai_insights_evidence.md` (real prose, 90%
 * confidence, then `· cached` on reload).
 */

const insight: InsightView = {
  content:
    'Stock is at 3 units with only 4 days of supply remaining, well below the 20-unit reorder point. Ordering 47 units rebuilds the position above the threshold.',
  confidence: 0.9,
  model: 'anthropic/claude-sonnet-4.6',
  promptVersion: 'v1',
  cached: false,
};

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/insights/actions', () => ({
  loadReorderInsight: vi.fn(async () => ({ ok: true, insight })),
}));

const { ReorderInsightPanel } = await import('@/components/InsightPanel/ReorderInsightPanel');

describe('ReorderInsightPanel (memorable)', () => {
  it('renders Claude prose with the cited model + prompt_version caption', async () => {
    const { container, getByText } = render(<ReorderInsightPanel poId="po-1" />);

    await waitFor(() => expect(getByText(/Ordering 47 units/)).toBeTruthy());

    // Trust hierarchy: the "Claude · {topic}" prefix marks it as interpretation.
    expect(getByText('Claude')).toBeTruthy();
    expect(getByText('why this reorder')).toBeTruthy();
    // The cited model + prompt version (FEATURES acceptance).
    expect(getByText(/anthropic\/claude-sonnet-4\.6 · prompt v1/)).toBeTruthy();
    // It renders as an <aside> interpretation (the trust-hierarchy lint test
    // separately guards that ClaudeInsight never wraps a StatNumber).
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('surfaces the low-confidence warning on sparse data', async () => {
    const { loadReorderInsight } = await import('@/lib/insights/actions');
    vi.mocked(loadReorderInsight).mockResolvedValueOnce({
      ok: true,
      insight: { ...insight, confidence: 0.4 },
    });
    const { getByText } = render(<ReorderInsightPanel poId="po-2" />);
    await waitFor(() => expect(getByText(/Limited history/)).toBeTruthy());
  });
});
