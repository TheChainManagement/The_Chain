import { describe, expect, it } from 'vitest';
import {
  forwardWeeklyDates,
  HORIZON_WEEKS,
  meanDailyDemand,
  saleDayCount,
  toWeeklySeries,
  trimmedMean,
} from '@/lib/forecast/series';

const NOW = Date.parse('2026-06-11T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function saleOn(daysAgo: number, qty = -3): { quantity: number; occurredAt: string } {
  return { quantity: qty, occurredAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

describe('saleDayCount — eligibility depth', () => {
  it('counts distinct calendar days, not movements', () => {
    const moves = [saleOn(2), saleOn(2, -1), saleOn(7)];
    expect(saleDayCount(moves)).toBe(2);
  });

  it('ignores unparseable timestamps', () => {
    expect(saleDayCount([{ quantity: -1, occurredAt: 'not-a-date' }])).toBe(0);
  });
});

describe('toWeeklySeries — Python request frame', () => {
  it('returns empty for a SKU with no demand', () => {
    expect(toWeeklySeries([], NOW)).toEqual([]);
  });

  it('trims leading zero weeks but keeps one ramp-in week', () => {
    // Demand only in the last ~10 weeks of the 52-week window.
    const moves = [saleOn(65), saleOn(30), saleOn(8)];
    const series = toWeeklySeries(moves, NOW);
    // 65 days ≈ week index 42 of 52 → one ramp-in zero week before it.
    expect(series.length).toBeGreaterThanOrEqual(10);
    expect(series.length).toBeLessThanOrEqual(12);
    expect(series[0]?.y).toBe(0);
    expect(series[1]?.y).toBeGreaterThan(0);
  });

  it('records demand as magnitude (sales are negative quantities)', () => {
    const series = toWeeklySeries([saleOn(3, -8)], NOW);
    expect(series.at(-1)?.y).toBe(8);
  });

  it('stamps ISO week-start dates oldest→newest', () => {
    const series = toWeeklySeries([saleOn(20), saleOn(3)], NOW);
    const dates = series.map((p) => p.ds);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('forwardWeeklyDates — benchmark fill dates', () => {
  it('produces the horizon of future week dates', () => {
    const dates = forwardWeeklyDates(NOW);
    expect(dates).toHaveLength(HORIZON_WEEKS);
    expect(Date.parse(dates[0] ?? '')).toBeGreaterThan(NOW);
  });
});

describe('trimmedMean — category benchmark statistic', () => {
  it('returns null on an empty sample', () => {
    expect(trimmedMean([])).toBeNull();
  });

  it('uses a plain mean for tiny samples instead of eating them', () => {
    expect(trimmedMean([2, 4])).toBe(3);
  });

  it('trims the tails on a real sample', () => {
    // 10 values; 10% trim drops the 0.1 and the 100 outliers.
    const values = [0.1, 3, 3.2, 3.4, 3.6, 3.8, 4, 4.2, 4.4, 100];
    const result = trimmedMean(values);
    expect(result).toBeGreaterThan(3);
    expect(result).toBeLessThan(5);
  });
});

describe('meanDailyDemand — benchmark contribution', () => {
  it('divides total demand by the whole window, not active days', () => {
    // 7 units once: 7 / 364 days.
    const rate = meanDailyDemand([saleOn(3, -7)], NOW);
    expect(rate).toBeCloseTo(7 / 364, 5);
  });
});
