// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuadrantGrid } from '@/app/(app)/inventory/classification/QuadrantGrid';
import type { Quadrant } from '@/lib/classification/queries';

/**
 * Memorable-element artifact (Block 7, MASTER_PROMPT "visible craft" gate).
 *
 * The classification cockpit's signature is the value × variability quadrant: the
 * catalog plotted ABC (value rank, rows) × XYZ (demand variability, columns), with
 * the A/B·Z "watch corner" — valuable AND hard to forecast — lit. This renders the
 * real `QuadrantGrid` over a fixture and asserts the grid, the watch flag, and the
 * awaiting-signal bucket. The reproducible visual lives at /gallery; this is the
 * on-disk CI artifact (`_reviews/**​/*_memorable.test.tsx` glob).
 */

const t = (sku: string, value: number) => ({
  productId: sku,
  sku,
  name: sku,
  value,
  adi: 1.2,
  cv2: 0.3,
});

const QUADRANT: Quadrant = {
  computedAt: '2026-06-10T19:40:00.000Z',
  classified: 4,
  cells: [
    { abc: 'A', xyz: 'X', count: 1, totalValue: 31200, items: [t('RBH-4471', 31200)] },
    { abc: 'A', xyz: 'Y', count: 0, totalValue: 0, items: [] },
    { abc: 'A', xyz: 'Z', count: 1, totalValue: 19880, items: [t('PMP-5520', 19880)] }, // watch
    { abc: 'B', xyz: 'X', count: 0, totalValue: 0, items: [] },
    { abc: 'B', xyz: 'Y', count: 0, totalValue: 0, items: [] },
    { abc: 'B', xyz: 'Z', count: 1, totalValue: 4990, items: [t('FTG-8841', 4990)] }, // watch
    { abc: 'C', xyz: 'X', count: 1, totalValue: 940, items: [t('TAP-0021', 940)] },
    { abc: 'C', xyz: 'Y', count: 0, totalValue: 0, items: [] },
    { abc: 'C', xyz: 'Z', count: 0, totalValue: 0, items: [] }, // empty, NOT a watch
  ],
  awaitingSignal: [t('NEW-0042', 0)],
};

describe('Classification quadrant (memorable element)', () => {
  it('lays out the value × variability grid with both axes labeled', () => {
    render(<QuadrantGrid quadrant={QUADRANT} />);
    for (const col of ['stable', 'variable', 'erratic']) expect(screen.getByText(col)).toBeTruthy();
    for (const row of ['vital few', 'significant', 'trivial many']) {
      expect(screen.getByText(row)).toBeTruthy();
    }
    expect(screen.getByRole('table', { name: /classification grid/i })).toBeTruthy();
  });

  it('lights the watch corner only on populated high-value × erratic cells', () => {
    render(<QuadrantGrid quadrant={QUADRANT} />);
    // A·Z and B·Z have SKUs → two WATCH flags. C·Z is empty → not flagged.
    expect(screen.getAllByText('WATCH')).toHaveLength(2);
  });

  it('renders SKU tiles with their classification badge', () => {
    render(<QuadrantGrid quadrant={QUADRANT} />);
    const watchSku = screen.getByText('PMP-5520');
    // Its row-cell carries an A·Z badge (aria-label from ClassificationBadge).
    const cell = watchSku.closest('[role="cell"]') as HTMLElement;
    expect(within(cell).getByLabelText(/Class A Z/i)).toBeTruthy();
  });

  it('surfaces value-ranked SKUs that have no variability signal yet', () => {
    render(<QuadrantGrid quadrant={QUADRANT} />);
    expect(screen.getByText(/1 ranked by value, no variability yet/i)).toBeTruthy();
    expect(screen.getByText('NEW-0042')).toBeTruthy();
  });
});
