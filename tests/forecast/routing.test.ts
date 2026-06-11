import { describe, expect, it } from 'vitest';
import { INTERMITTENT_ADI } from '@/lib/classification/compute';
import {
  type ColdStartState,
  eligibility,
  eligibilityLabel,
  eligibilityThresholdMet,
  routeForecast,
} from '@/lib/forecast/routing';

describe('eligibility', () => {
  it('is cold with no sale-days at all', () => {
    expect(eligibility(0)).toBe('cold');
  });
  it('is cold under 30 sale-days (one ancient sale does NOT make it warm)', () => {
    expect(eligibility(1)).toBe('cold');
    expect(eligibility(29)).toBe('cold');
  });
  it('is warming from 30 to 89 sale-days', () => {
    expect(eligibility(30)).toBe('warming');
    expect(eligibility(89)).toBe('warming');
  });
  it('is warm at 90+ sale-days', () => {
    expect(eligibility(90)).toBe('warm');
    expect(eligibility(400)).toBe('warm');
  });
  it('only warm meets the threshold (promotable)', () => {
    const states: ColdStartState[] = ['cold', 'warming', 'warm'];
    expect(states.map(eligibilityThresholdMet)).toEqual([false, false, true]);
  });
  it('carries the FEATURES operator copy per state', () => {
    expect(eligibilityLabel('cold')).toMatch(/category benchmark/i);
    expect(eligibilityLabel('warming')).toMatch(/confidence limited/i);
    expect(eligibilityLabel('warm')).toMatch(/full history/i);
  });
});

describe('routeForecast', () => {
  it('cold SKUs never get a model — category benchmark', () => {
    const r = routeForecast({ state: 'cold', adi: 5, cv2: 2 });
    expect(r.method).toBe('benchmark');
    expect(r.modeled).toBe(false);
  });

  it('no demand signal (null adi) falls back to benchmark', () => {
    expect(routeForecast({ state: 'warm', adi: null, cv2: null }).method).toBe('benchmark');
  });

  it('intermittent + smooth sizes routes to Croston-SBA', () => {
    expect(routeForecast({ state: 'warm', adi: INTERMITTENT_ADI, cv2: 0.2 }).method).toBe(
      'croston_sba',
    );
  });

  it('intermittent + erratic sizes (lumpy) routes to TSB', () => {
    expect(routeForecast({ state: 'warming', adi: 4.1, cv2: 1.5 }).method).toBe('tsb');
  });

  it('regular + smooth (low CV²) routes to AutoETS', () => {
    const r = routeForecast({ state: 'warm', adi: 1.05, cv2: 0.2 });
    expect(r.method).toBe('auto_ets');
    expect(r.modeled).toBe(true);
  });

  it('regular + erratic (high CV²) routes to AutoARIMA', () => {
    expect(routeForecast({ state: 'warm', adi: 1.1, cv2: 0.9 }).method).toBe('auto_arima');
  });
});
