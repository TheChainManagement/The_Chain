import { describe, expect, it } from 'vitest';
import { liftCaption, methodLabel } from '@/lib/forecast/detail';

const evaluation = (rmsse: number | null, baseline: number | null) => ({
  rmsse,
  wape: 0.2,
  baselineRmsse: baseline,
  beatsBaseline: rmsse != null && baseline != null ? rmsse < baseline : null,
  windows: 2,
});

describe('liftCaption — the trust line under the chart', () => {
  it('states the lift when the model beats seasonal-naive', () => {
    expect(liftCaption('auto_ets', evaluation(0.857, 1.0))).toBe(
      'Beats seasonal-naive by 14.3% RMSSE',
    );
  });

  it('admits when the model trails the baseline', () => {
    expect(liftCaption('sba', evaluation(1.1, 1.0))).toBe(
      'Trails seasonal-naive by 10.0% RMSSE — not promoted',
    );
  });

  it('never pretends a benchmark fill has a model to judge', () => {
    expect(liftCaption('benchmark', null)).toMatch(/no model to judge/);
  });

  it('says when the backtest could not run', () => {
    expect(liftCaption('auto_ets', evaluation(null, null))).toMatch(/Backtest unavailable/);
  });

  it('handles a degenerate baseline without dividing by zero', () => {
    expect(liftCaption('auto_ets', evaluation(0.5, 0))).toMatch(/degenerate/);
  });
});

describe('methodLabel — enum to operator vocabulary', () => {
  it('maps sba to its full Croston-SBA name', () => {
    expect(methodLabel('sba')).toBe('Croston-SBA');
  });

  it('passes unknown values through rather than guessing', () => {
    expect(methodLabel('future_method')).toBe('future_method');
  });
});
