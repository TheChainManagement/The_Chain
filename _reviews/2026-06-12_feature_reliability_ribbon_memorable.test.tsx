// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReliabilityRibbon } from '@/components/ReliabilityRibbon/ReliabilityRibbon';
import { buildReliabilityRibbon } from '@/lib/suppliers/transform';

/**
 * Memorable-element artifact (Block 10, MASTER_PROMPT "visible craft" gate).
 *
 * Block 4 built the reliability ribbon but left it DIM — "real OTIF / a lit
 * ribbon" was deferred to Block 10 (the producer). This artifact proves the
 * ribbon now LIGHTS from real supplier_performance outcomes: cobalt for
 * on-time-in-full, amber for short, stop-red for late — the supplier's
 * reputation read in one glance. Drives the real `buildReliabilityRibbon`
 * (the producer's output shape) into the real `ReliabilityRibbon`.
 */

// What the receipt engine writes: one row per delivery, newest first.
const PERFORMANCE = [
  { on_time: true, in_full: true, on_time_in_full: true, actual_delivery_at: '2026-06-10', recorded_at: '2026-06-10', po_id: 'po-6' },
  { on_time: false, in_full: true, on_time_in_full: false, actual_delivery_at: '2026-06-02', recorded_at: '2026-06-02', po_id: 'po-5' },
  { on_time: true, in_full: false, on_time_in_full: false, actual_delivery_at: '2026-05-20', recorded_at: '2026-05-20', po_id: 'po-4' },
  { on_time: true, in_full: true, on_time_in_full: true, actual_delivery_at: '2026-05-11', recorded_at: '2026-05-11', po_id: 'po-3' },
];

function tileStates(): string[] {
  const ribbon = screen.getByRole('img');
  return [...ribbon.querySelectorAll('span')].map((el) => el.className);
}

describe('Reliability ribbon (memorable element, now lit)', () => {
  it('lights each delivery by its OTIF outcome, newest first', () => {
    const tiles = buildReliabilityRibbon(PERFORMANCE);
    render(<ReliabilityRibbon tiles={tiles} />);
    const classes = tileStates();

    // OTIF → otif (cobalt), late → late (stop), short → short (amber).
    expect(classes[0]).toMatch(/otif/); // po-6 on-time-in-full
    expect(classes[1]).toMatch(/late/); // po-5 late
    expect(classes[2]).toMatch(/short/); // po-4 short
    expect(classes[3]).toMatch(/otif/); // po-3
  });

  it('always renders the full 8-tile shape, padding the rest as pending', () => {
    const tiles = buildReliabilityRibbon(PERFORMANCE);
    render(<ReliabilityRibbon tiles={tiles} />);
    const classes = tileStates();
    expect(classes).toHaveLength(8);
    expect(classes.slice(4).every((c) => /pending/.test(c))).toBe(true);
  });

  it('a brand-new supplier still shows the ribbon it will earn (all pending)', () => {
    render(<ReliabilityRibbon tiles={buildReliabilityRibbon([])} />);
    expect(screen.getByRole('img', { name: /no delivery history/i })).toBeTruthy();
    expect(tileStates().every((c) => /pending/.test(c))).toBe(true);
  });
});
