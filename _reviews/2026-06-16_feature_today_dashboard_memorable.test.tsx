// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChainStepView } from '@/app/(app)/today/TodayChain';

/**
 * Memorable-artifact guard for the Today dashboard (Block 15). The memorable
 * element: the centerpiece chain's ACTIVE link pulses a cobalt heartbeat while
 * today's recommendation is unacknowledged; the operator acknowledges and the
 * heartbeat STOPS, replaced by a steady flow-green settled dot. The dashboard's
 * active state is literally a heartbeat on the chain.
 *
 * This drives the real TodayChain client component through that exact
 * transition (pulse-on → acknowledge → pulse-off + settled). Paired with the
 * live browser capture noted in
 * `_reviews/2026-06-16_feature_today_dashboard.md`.
 */

const acknowledge = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/app/(app)/today/actions', () => ({
  acknowledgeTopRecommendation: acknowledge,
}));

const { TodayChain } = await import('@/app/(app)/today/TodayChain');

const steps: ChainStepView[] = [
  { step: 'SUPPLIER', label: 'Atchafalaya Distributing', state: 'done', connector: 'cobalt' },
  { step: 'ORDERED', label: 'PO-1042', state: 'done', connector: 'cobalt' },
  {
    step: 'IN TRANSIT',
    label: 'In transit',
    when: 'due Jun 20',
    state: 'active',
    connector: 'pewter',
  },
  { step: 'RECEIVED', label: 'Received', state: 'pending', connector: 'none' },
];

function renderChain(topAlertId: string | null) {
  return render(
    <TodayChain
      steps={steps}
      activeIndex={2}
      reference="PO-1042"
      poHref="/purchase-orders/po-1042"
      topAlertId={topAlertId}
      topAlertMemo="BLT-200 is 3 units against a 20 trigger — order before it runs dry."
    />,
  );
}

describe('TodayChain (memorable)', () => {
  it('pulses the active link while a recommendation is unacknowledged', () => {
    const { container } = renderChain('alert-1');
    const active = container.querySelector('[data-state="active"]');
    expect(active?.getAttribute('data-pulse')).toBe('true');
    expect(active?.getAttribute('data-settled')).toBe('false');
  });

  it('stops the heartbeat and settles the link after acknowledge', async () => {
    const { container, getByRole } = renderChain('alert-1');
    fireEvent.click(getByRole('button', { name: /acknowledge/i }));

    await waitFor(() => {
      const active = container.querySelector('[data-state="active"]');
      expect(active?.getAttribute('data-pulse')).toBe('false');
      expect(active?.getAttribute('data-settled')).toBe('true');
    });
    expect(acknowledge).toHaveBeenCalledWith('alert-1');
    expect(container.textContent).toContain('Acknowledged');
  });

  it('rests without a heartbeat when nothing is pressing', () => {
    const { container } = renderChain(null);
    const active = container.querySelector('[data-state="active"]');
    expect(active?.getAttribute('data-pulse')).toBe('false');
    expect(container.textContent).toContain('Nothing needs your eye');
  });
});
