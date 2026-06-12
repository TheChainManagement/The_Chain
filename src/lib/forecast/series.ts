/**
 * Demand series preparation for the forecast batch (Block 8 Wave 2b) — pure.
 *
 * Bridges raw `stock_movements` sale rows to the Python function's request shape
 * (weekly observations, oldest→newest) and computes the demand-depth facts the
 * eligibility ladder needs (distinct sale-days, not elapsed time).
 *
 * Weekly bucketing reuses the same window convention as the classification
 * engine (trailing DEMAND_WEEKS ending now); leading all-zero weeks before the
 * first observed demand are trimmed so a SKU first sold 10 weeks ago isn't fit
 * on 42 weeks of fake zeros.
 */

import { bucketWeeklyDemand, DEMAND_WEEKS } from '@/lib/classification/compute';

export interface Movement {
  quantity: number;
  occurredAt: string;
}

export interface SeriesPoint {
  ds: string; // ISO date (week start)
  y: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Forecast horizon in weekly periods (8 weeks ≈ the reorder planning window). */
export const HORIZON_WEEKS = 8;

/**
 * Count the distinct calendar days (UTC) that carry a sale movement — the
 * eligibility ladder's input. One ancient sale = 1, not "warm".
 */
export function saleDayCount(movements: Movement[]): number {
  const days = new Set<string>();
  for (const m of movements) {
    const t = Date.parse(m.occurredAt);
    if (Number.isNaN(t)) continue;
    days.add(new Date(t).toISOString().slice(0, 10));
  }
  return days.size;
}

/**
 * Weekly demand observations for the Python function: trailing DEMAND_WEEKS
 * bucketed via the classification convention, leading zero weeks trimmed, each
 * point stamped with its week-start date.
 */
export function toWeeklySeries(movements: Movement[], nowMs: number): SeriesPoint[] {
  const series = bucketWeeklyDemand(movements, nowMs);
  const windowStart = nowMs - DEMAND_WEEKS * WEEK_MS;

  let first = series.findIndex((v) => v > 0);
  if (first === -1) return [];
  // Keep one leading zero week when there is room — a fit anchored exactly on
  // the first sale week reads the ramp-in as level.
  first = Math.max(0, first - 1);

  const points: SeriesPoint[] = [];
  for (let i = first; i < series.length; i++) {
    points.push({
      ds: new Date(windowStart + i * WEEK_MS).toISOString().slice(0, 10),
      y: series[i] ?? 0,
    });
  }
  return points;
}

/**
 * Forward weekly period dates for benchmark fills (cold SKUs get no model call,
 * so we generate their forecast_points dates here).
 */
export function forwardWeeklyDates(nowMs: number, horizon: number = HORIZON_WEEKS): string[] {
  const out: string[] = [];
  for (let i = 1; i <= horizon; i++) {
    out.push(new Date(nowMs + i * WEEK_MS).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Trimmed mean (default 10% per tail) — the category benchmark statistic.
 * With fewer than 3 values the trim would eat the sample; fall back to a plain
 * mean. Returns null for an empty sample.
 */
export function trimmedMean(values: number[], trim = 0.1): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const k = sorted.length >= 3 ? Math.floor(sorted.length * trim) : 0;
  const kept = sorted.slice(k, sorted.length - k);
  if (kept.length === 0) return null;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/**
 * Mean daily demand over the trailing window — the per-SKU value the category
 * benchmark aggregates. Uses the full window (not just active weeks) so a SKU
 * that sells rarely contributes a low rate, not an inflated one.
 */
export function meanDailyDemand(movements: Movement[], nowMs: number): number {
  const series = bucketWeeklyDemand(movements, nowMs);
  const total = series.reduce((a, b) => a + b, 0);
  return total / (DEMAND_WEEKS * 7);
}
