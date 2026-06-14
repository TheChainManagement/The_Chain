// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AlertView } from '@/lib/alerts/queue';

/**
 * Memorable-artifact guard for the in-app alerts engine. The memorable element:
 * each alert IS a one-sentence operator memo with the numbers that matter and a
 * single cobalt CTA straight to the fix — not a vague "stockout risk on SKU
 * 47331." This asserts the row renders the full memo + the cobalt CTA link.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(app)/flow/alerts/actions', () => ({
  acknowledgeAlert: vi.fn(async () => ({ ok: true })),
  dismissAlert: vi.fn(async () => ({ ok: true })),
  recomputeAlerts: vi.fn(async () => ({ ok: true })),
}));

const { AlertsQueue } = await import('@/app/(app)/flow/alerts/AlertsQueue');

const alert = (over: Partial<AlertView> = {}): AlertView => ({
  id: 'a1',
  kind: 'reorder_due',
  severity: 'critical',
  memo: 'BLT-200 hit its reorder point — 3 on hand against a 20 trigger. Reorder 47 to rebuild cover.',
  ctaLabel: 'Review reorder',
  ctaHref: '/reorder',
  reopenCount: 0,
  createdAt: '2026-06-13T00:00:00.000Z',
  ...over,
});

describe('AlertsQueue (memorable)', () => {
  it('renders the full operator memo and a cobalt CTA to the fix', () => {
    const { getByTestId, getByText } = render(<AlertsQueue alerts={[alert()]} />);
    const row = getByTestId('alert-row');
    // The memo carries the actionable numbers, not a vague label.
    expect(row.textContent).toContain('Reorder 47 to rebuild cover');
    // The single cobalt slot: a CTA link straight to the action.
    const cta = getByText('Review reorder →') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/reorder');
    expect(row.getAttribute('data-severity')).toBe('critical');
  });

  it('surfaces escalation count when a condition has re-fired', () => {
    const { getByText } = render(<AlertsQueue alerts={[alert({ reopenCount: 2 })]} />);
    expect(getByText(/escalated ×2/)).toBeTruthy();
  });

  it('shows the empty state when nothing is open', () => {
    const { getByText } = render(<AlertsQueue alerts={[]} />);
    expect(getByText(/No open alerts/)).toBeTruthy();
  });
});
