/**
 * ABC / XYZ classification math (Block 7) — pure, no I/O.
 *
 * Two independent axes, both computed from `stock_movements` demand history:
 *
 *  - **ABC** (value): SKUs ranked by trailing-365d consumption value (demand qty ×
 *    unit value). Pareto cumulative-share cutoffs (`abc_cuts`, e.g. [0.80, 0.95])
 *    split the ranked list into A (the vital few), B, C (the trivial many).
 *
 *  - **XYZ** (demand variability): the squared coefficient of variation (CV²) of
 *    demand SIZES in the periods where demand occurred, bucketed by `xyz_cuts`
 *    (e.g. [0.5, 1.0]) into X (smooth), Y (variable), Z (erratic).
 *
 * We also compute **ADI** (average demand interval = periods ÷ periods-with-demand),
 * stored alongside but NOT used for the XYZ bucket. ADI is what the Block 8 forecast
 * routing reads to send intermittent SKUs (ADI ≥ ~1.32) to the Croston/SBA/TSB
 * family — classification and forecasting share this one computation.
 *
 * Convention: ADI + CV² follow Syntetos-Boylan — CV² is taken over the non-zero
 * demand sizes, not over every period.
 */

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

/** Number of trailing weekly periods the demand series spans (1 year). */
export const DEMAND_WEEKS = 52;
/** ADI at or above this is "intermittent" — the Block 8 routing threshold (stored, not used for XYZ). */
export const INTERMITTENT_ADI = 1.32;

export interface XyzResult {
  /** Average demand interval: periods ÷ periods-with-demand. Null when there is no demand. */
  adi: number | null;
  /** Squared coefficient of variation of non-zero demand sizes. Null when there is no demand. */
  cv2: number | null;
  xyzClass: XyzClass | null;
}

/**
 * Bucket signed sale movements into a fixed-length weekly demand series ending now.
 * Demand is the MAGNITUDE of outflow (sales are stored as negative quantities), so a
 * sale of -8 contributes 8 units of demand to its week. Movements outside the window
 * are ignored; the returned array always has `weeks` entries (zero-filled).
 */
export function bucketWeeklyDemand(
  movements: Array<{ quantity: number; occurredAt: string }>,
  nowMs: number,
  weeks: number = DEMAND_WEEKS,
): number[] {
  const series = new Array<number>(weeks).fill(0);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const windowStart = nowMs - weeks * weekMs;
  for (const m of movements) {
    const t = Date.parse(m.occurredAt);
    if (Number.isNaN(t) || t <= windowStart || t > nowMs) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - windowStart) / weekMs));
    series[idx] = (series[idx] ?? 0) + Math.abs(m.quantity);
  }
  return series;
}

/** Compute ADI + CV² + the XYZ bucket from a weekly demand series. */
export function computeXyz(series: number[], xyzCuts: number[]): XyzResult {
  const nonZero = series.filter((v) => v > 0);
  if (nonZero.length === 0) return { adi: null, cv2: null, xyzClass: null };

  const adi = series.length / nonZero.length;

  const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  // Population variance of the non-zero demand sizes.
  const variance = nonZero.reduce((a, b) => a + (b - mean) ** 2, 0) / nonZero.length;
  const cv2 = mean === 0 ? 0 : variance / mean ** 2;

  return { adi, cv2, xyzClass: bucketXyz(cv2, xyzCuts) };
}

/** X if CV² ≤ cuts[0], Y if ≤ cuts[1], else Z. */
export function bucketXyz(cv2: number, xyzCuts: number[]): XyzClass {
  const [xCut = 0, yCut = Number.POSITIVE_INFINITY] = xyzCuts;
  if (cv2 <= xCut) return 'X';
  if (cv2 <= yCut) return 'Y';
  return 'Z';
}

export interface AbcInput<T> {
  item: T;
  /** Trailing-365d consumption value (demand qty × unit value). */
  value: number;
}
export interface AbcResult<T> {
  item: T;
  value: number;
  abcClass: AbcClass;
}

/**
 * Assign ABC by Pareto cumulative value share. Items are ranked by value descending;
 * an item lands in A while the running cumulative share is ≤ cuts[0], B while ≤ cuts[1],
 * else C. When the total value is zero (no demand / no costs) every SKU is C.
 */
export function assignAbc<T>(items: Array<AbcInput<T>>, abcCuts: number[]): Array<AbcResult<T>> {
  const total = items.reduce((a, b) => a + b.value, 0);
  const ranked = [...items].sort((a, b) => b.value - a.value);

  if (total <= 0) return ranked.map((i) => ({ item: i.item, value: i.value, abcClass: 'C' }));

  const [aCut = 1, bCut = 1] = abcCuts;
  let cumulative = 0;
  return ranked.map((i) => {
    cumulative += i.value;
    const share = cumulative / total;
    const abcClass: AbcClass = share <= aCut ? 'A' : share <= bCut ? 'B' : 'C';
    return { item: i.item, value: i.value, abcClass };
  });
}
