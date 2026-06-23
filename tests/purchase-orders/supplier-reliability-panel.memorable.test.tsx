// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SupplierReliabilityPanel } from '@/app/(app)/purchase-orders/[poId]/SupplierReliabilityPanel';
import type { ReliabilityTile, SupplierDetail } from '@/lib/suppliers/transform';

/**
 * Guard for the supplier reliability panel surfaced on the PO hero (2026-06-23,
 * FEATURES.md:451). It puts the supplier's reputation where the approve/receive
 * decision is made: the ribbon forms from real delivery tiles, the rolling-30d
 * OTIF / on-time / in-full + actual lead time read from the scorecard, and a
 * brand-new supplier still shows the ribbon it will earn rather than a blank.
 */

const tiles = (states: ReliabilityTile['state'][]): ReliabilityTile[] =>
  states.map((state, i) => ({ state, poRef: `PO-${i}`, when: '2026-06-20' }));

const supplier = (over: Partial<SupplierDetail> = {}): SupplierDetail => ({
  id: 'sup-1',
  name: 'Bayou Components LLC',
  status: 'active',
  contact: {},
  defaultLeadTimeDays: 7,
  minOrderValue: null,
  qboVendorId: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  products: [],
  reliability: tiles(['otif', 'otif', 'late', 'short', 'otif']),
  otifPct: 0.82,
  onTimePct: 0.9,
  inFullPct: 0.88,
  leadTimeAvgDays: 6.4,
  leadTimeStddevDays: 1.2,
  scorecardSampleSize: 11,
  ...over,
});

describe('SupplierReliabilityPanel', () => {
  it('forms the ribbon from delivery history and reads the rolling-30d scorecard', () => {
    const { container, getByRole, getByText } = render(
      <SupplierReliabilityPanel supplier={supplier()} />,
    );

    // The ribbon reports its delivered count (5 of 5 here, none pending).
    expect(getByRole('img', { name: /purchase orders shown/ }).getAttribute('aria-label')).toBe(
      '5 of the last 5 purchase orders shown',
    );

    // OTIF + its sub-stats read straight off the scorecard.
    const text = container.textContent ?? '';
    expect(text).toContain('82'); // OTIF 30d
    expect(text).toContain('on-time 90%');
    expect(text).toContain('in-full 88%');
    // Actual lead time ±σ and the sample size.
    expect(text).toContain('6.4');
    expect(text).toContain('11');
    expect(text).toContain('POs');

    // Links back to the full supplier scorecard.
    const link = getByText('Full scorecard →').closest('a');
    expect(link?.getAttribute('href')).toBe('/suppliers/sup-1');
  });

  it('a never-delivered supplier shows the pending ribbon and honest empty stats', () => {
    const fresh = supplier({
      reliability: tiles(['pending', 'pending', 'pending']),
      otifPct: null,
      onTimePct: null,
      inFullPct: null,
      leadTimeAvgDays: null,
      leadTimeStddevDays: null,
      scorecardSampleSize: 0,
    });
    const { container, getByRole } = render(<SupplierReliabilityPanel supplier={fresh} />);

    // The ribbon still renders its full shape, labelled as empty (never a blank).
    expect(getByRole('img', { name: 'No delivery history yet' })).toBeTruthy();
    // No fabricated OTIF: the sub-stats fall back to em-dashes.
    const text = container.textContent ?? '';
    expect(text).toContain('on-time —');
    expect(text).toContain('in-full —');
  });
});
