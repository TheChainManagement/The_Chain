import { describe, expect, it } from 'vitest';
import {
  assignAbc,
  bucketWeeklyDemand,
  bucketXyz,
  computeXyz,
  DEMAND_WEEKS,
} from '@/lib/classification/compute';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-10T00:00:00.000Z');
const weeksAgo = (n: number) => new Date(NOW - n * WEEK + WEEK / 2).toISOString();

describe('bucketWeeklyDemand', () => {
  it('uses outflow magnitude and ignores movements outside the window', () => {
    const series = bucketWeeklyDemand(
      [
        { quantity: -8, occurredAt: weeksAgo(1) }, // recent week, demand 8
        { quantity: -2, occurredAt: weeksAgo(1) }, // same week, +2 → 10
        { quantity: -5, occurredAt: weeksAgo(60) }, // older than 52w → dropped
      ],
      NOW,
    );
    expect(series).toHaveLength(DEMAND_WEEKS);
    expect(series.reduce((a, b) => a + b, 0)).toBe(10);
    expect(series[series.length - 1]).toBe(10); // most recent bucket
  });
});

describe('computeXyz', () => {
  it('returns nulls when there is no demand', () => {
    expect(computeXyz(new Array(DEMAND_WEEKS).fill(0), [0.5, 1.0])).toEqual({
      adi: null,
      cv2: null,
      xyzClass: null,
    });
  });

  it('steady, every-period demand is smooth (X) with ADI 1', () => {
    const r = computeXyz(new Array(DEMAND_WEEKS).fill(10), [0.5, 1.0]);
    expect(r.adi).toBe(1);
    expect(r.cv2).toBeCloseTo(0, 10);
    expect(r.xyzClass).toBe('X');
  });

  it('intermittent demand drives ADI well above 1', () => {
    const series = new Array(DEMAND_WEEKS).fill(0);
    series[0] = 5;
    series[10] = 5;
    series[20] = 5;
    series[30] = 5; // 4 demand periods over 52
    const r = computeXyz(series, [0.5, 1.0]);
    expect(r.adi).toBeCloseTo(DEMAND_WEEKS / 4, 6);
    expect(r.cv2).toBeCloseTo(0, 10); // equal sizes → smooth size variability
    expect(r.xyzClass).toBe('X');
  });

  it('highly erratic demand sizes land in Z', () => {
    // Several small demands and one large spike push CV² above 1 (two values alone
    // can't exceed CV²=1; an outlier among many does).
    const series = new Array(DEMAND_WEEKS).fill(0);
    series[0] = 1;
    series[1] = 1;
    series[2] = 1;
    series[3] = 100; // big spike against a quiet baseline
    const r = computeXyz(series, [0.5, 1.0]);
    expect(r.cv2).toBeGreaterThan(1.0);
    expect(r.xyzClass).toBe('Z');
  });
});

describe('bucketXyz', () => {
  it('respects the CV² cutoffs inclusively on the lower edge', () => {
    expect(bucketXyz(0.5, [0.5, 1.0])).toBe('X');
    expect(bucketXyz(0.51, [0.5, 1.0])).toBe('Y');
    expect(bucketXyz(1.0, [0.5, 1.0])).toBe('Y');
    expect(bucketXyz(1.01, [0.5, 1.0])).toBe('Z');
  });
});

describe('assignAbc', () => {
  it('splits by cumulative value share, vital few first', () => {
    // 70 / 20 / 6 / 4 → A captures 70 (≤80%), B adds 20 (→90%, ≤95%), C the tail.
    const out = assignAbc(
      [
        { item: 'p70', value: 70 },
        { item: 'p20', value: 20 },
        { item: 'p6', value: 6 },
        { item: 'p4', value: 4 },
      ],
      [0.8, 0.95, 1.0],
    );
    const byItem = Object.fromEntries(out.map((o) => [o.item, o.abcClass]));
    expect(byItem.p70).toBe('A');
    expect(byItem.p20).toBe('B');
    expect(byItem.p6).toBe('C');
    expect(byItem.p4).toBe('C');
  });

  it('makes everything C when total value is zero', () => {
    const out = assignAbc(
      [
        { item: 'a', value: 0 },
        { item: 'b', value: 0 },
      ],
      [0.8, 0.95, 1.0],
    );
    expect(out.every((o) => o.abcClass === 'C')).toBe(true);
  });
});
