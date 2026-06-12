// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ForecastChart } from '@/components/ForecastChart/ForecastChart';
import { liftCaption } from '@/lib/forecast/detail';

/**
 * Memorable-element artifact (Block 8 Wave 2c, MASTER_PROMPT "visible craft"
 * gate) — THE chart, the FEATURES-named centerpiece:
 *
 *   "History renders as a Plex Mono tabular timeline; forecast renders as
 *    forward-projecting points with 80%/95% confidence bands shown as widening
 *    pewter rings. A small cobalt diamond marks 'today.' Below the chart, a
 *    tiny mono caption reads 'Beats seasonal-naive by 14.3% RMSSE.'"
 *
 * Drives the REAL ForecastChart + the REAL liftCaption over a fixture and
 * asserts the three signature facts: the today-diamond exists at the
 * history/forecast boundary, the 95% bands WIDEN over the horizon (the rings),
 * and the caption states the exact baseline verdict. /forecasts/[productId]
 * renders the same components against live data.
 */

const history = Array.from({ length: 12 }, (_, i) => ({
  ds: `2026-0${Math.floor(i / 4) + 3}-${String((i % 4) * 7 + 3).padStart(2, '0')}`,
  y: [14, 12, 17, 11, 15, 13, 18, 12, 16, 14, 13, 15][i] ?? 0,
}));

// Bands widen with the horizon — the statistical truth the rings make visible.
const points = [
  { ds: '2026-06-18', mean: 14.2, lo95: 10.9, hi95: 17.5, lo80: 12.1, hi80: 16.3 },
  { ds: '2026-06-25', mean: 14.4, lo95: 9.8, hi95: 19.0, lo80: 11.4, hi80: 17.4 },
  { ds: '2026-07-02', mean: 14.5, lo95: 8.9, hi95: 20.1, lo80: 10.8, hi80: 18.2 },
  { ds: '2026-07-09', mean: 14.6, lo95: 8.1, hi95: 21.2, lo80: 10.2, hi80: 19.0 },
];

const evaluation = {
  rmsse: 0.857,
  wape: 0.21,
  baselineRmsse: 1.0,
  beatsBaseline: true,
  windows: 2,
};

describe('Forecast chart (memorable element)', () => {
  it('marks today with the single cobalt diamond at the boundary', () => {
    render(<ForecastChart history={history} points={points} label="memorable" />);
    const diamond = screen.getByTestId('today-diamond');
    expect(diamond).toBeTruthy();
    expect(screen.getByText('TODAY')).toBeTruthy();
    // Exactly one diamond — cobalt keeps its one intent slot in the chart.
    expect(screen.getAllByTestId('today-diamond')).toHaveLength(1);
  });

  it('draws the 95% bands as rings that WIDEN across the horizon', () => {
    render(<ForecastChart history={history} points={points} label="memorable" />);
    const spans = screen.getAllByTestId('band-95').map((el) => {
      const y1 = Number(el.getAttribute('y1'));
      const y2 = Number(el.getAttribute('y2'));
      return Math.abs(y2 - y1);
    });
    expect(spans).toHaveLength(4);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]).toBeGreaterThan(spans[i - 1] ?? 0);
    }
    // The 80% ring nests inside the 95% ring at every week.
    const inner = screen.getAllByTestId('band-80').map((el) => {
      const y1 = Number(el.getAttribute('y1'));
      const y2 = Number(el.getAttribute('y2'));
      return Math.abs(y2 - y1);
    });
    inner.forEach((span, i) => {
      expect(span).toBeLessThan(spans[i] ?? 0);
    });
  });

  it('renders history as discrete weekly markers feeding the forecast', () => {
    render(<ForecastChart history={history} points={points} label="memorable" />);
    expect(screen.getAllByTestId('history-dot')).toHaveLength(12);
    expect(screen.getByText('HISTORY · WEEKLY DEMAND')).toBeTruthy();
    expect(screen.getByText('FORECAST · 4 WK')).toBeTruthy();
  });

  it('captions the chart with the exact baseline verdict', () => {
    render(<p data-testid="caption">{liftCaption('auto_ets', evaluation)}</p>);
    expect(screen.getByTestId('caption').textContent).toBe(
      'Beats seasonal-naive by 14.3% RMSSE',
    );
  });
});
