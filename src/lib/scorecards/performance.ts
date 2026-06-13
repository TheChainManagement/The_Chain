/**
 * Supplier reliability math (Block 10) — pure, no I/O.
 *
 * Two computations, both from PO-receipt FACTS, never a user-input field
 * (FEATURES acceptance: reliability is computed from history):
 *
 *  - **assessReceipt** — one delivery's on-time / in-full / OTIF flags.
 *    On-time = delivered on or before the promised date (day granularity, so a
 *    same-day delivery counts). In-full = received quantity met what was
 *    ordered. OTIF = both. A missing promised date can't be judged for timing,
 *    so on_time is null and OTIF degrades to in-full only — we never invent a
 *    promise we didn't have.
 *
 *  - **rollupWindow** — a supplier's percentages + empirical lead time over a
 *    time window. Lead time is the realized order-to-door duration (delivery −
 *    order date); its stddev is the σ_L the Block 9 safety-stock formula
 *    consumes once the sample is real (≥ 5).
 */

export type ScorecardWindow = 'rolling_30d' | 'rolling_90d' | 'rolling_365d' | 'all_time';

export const SCORECARD_WINDOWS: { kind: ScorecardWindow; days: number | null }[] = [
  { kind: 'rolling_30d', days: 30 },
  { kind: 'rolling_90d', days: 90 },
  { kind: 'rolling_365d', days: 365 },
  { kind: 'all_time', days: null },
];

export interface ReceiptAssessment {
  onTime: boolean | null;
  inFull: boolean;
  otif: boolean;
}

/**
 * Judge one receipt. `promisedDeliveryAt` null ⇒ timing unknown (on_time null,
 * OTIF falls back to in-full). Quantities compare received-so-far vs ordered.
 */
export function assessReceipt(input: {
  promisedDeliveryAt: string | null;
  actualDeliveryAt: string;
  orderedQty: number;
  receivedQty: number;
}): ReceiptAssessment {
  const inFull = input.receivedQty >= input.orderedQty;

  if (!input.promisedDeliveryAt) {
    return { onTime: null, inFull, otif: inFull };
  }
  const promised = dayStart(input.promisedDeliveryAt);
  const actual = dayStart(input.actualDeliveryAt);
  if (promised == null || actual == null) {
    return { onTime: null, inFull, otif: inFull };
  }
  const onTime = actual <= promised;
  return { onTime, inFull, otif: onTime && inFull };
}

export interface PerformanceRow {
  onTime: boolean | null;
  inFull: boolean | null;
  otif: boolean | null;
  /** When the goods actually ARRIVED — the window anchor (FEATURES is about
   * delivery facts, so a late-entered old delivery counts in its real window,
   * not by entry time). Falls back to recordedAt when absent. */
  deliveryAt: string | null;
  recordedAt: string;
  /** Realized lead time in days (delivery − order date); null when unknown. */
  leadTimeDays: number | null;
}

export interface WindowStats {
  otifPct: number | null;
  onTimePct: number | null;
  inFullPct: number | null;
  leadTimeAvgDays: number | null;
  leadTimeStddevDays: number | null;
  sampleSize: number;
}

/**
 * Rows whose DELIVERY date falls inside the window ending now. Anchored on the
 * actual delivery (recordedAt fallback), so backdating a late-entered receipt
 * places it in its real window rather than skewing today's 30-day numbers.
 */
export function windowRows(
  rows: PerformanceRow[],
  days: number | null,
  nowMs: number,
): PerformanceRow[] {
  if (days == null) return rows;
  const since = nowMs - days * 24 * 60 * 60 * 1000;
  return rows.filter((r) => {
    const t = Date.parse(r.deliveryAt ?? r.recordedAt);
    return !Number.isNaN(t) && t >= since;
  });
}

/**
 * Roll a window's rows into the scorecard stats. Percentages are fractions in
 * [0,1] (the column type). Timing rates only count rows that HAVE a timing
 * verdict (a null-promise delivery can't lower on-time %). Lead-time avg + the
 * population stddev come from rows with a realized lead time.
 */
export function rollupWindow(rows: PerformanceRow[]): WindowStats {
  const n = rows.length;
  if (n === 0) {
    return {
      otifPct: null,
      onTimePct: null,
      inFullPct: null,
      leadTimeAvgDays: null,
      leadTimeStddevDays: null,
      sampleSize: 0,
    };
  }

  const timed = rows.filter((r) => r.onTime != null);
  const onTimePct =
    timed.length === 0 ? null : frac(timed.filter((r) => r.onTime).length, timed.length);
  const inFullPct = frac(rows.filter((r) => r.inFull).length, n);
  // OTIF over timed rows (an unjudgeable promise can't be "on time in full").
  const otifPct =
    timed.length === 0 ? null : frac(timed.filter((r) => r.otif).length, timed.length);

  const leads = rows.map((r) => r.leadTimeDays).filter((d): d is number => d != null && d >= 0);
  let leadAvg: number | null = null;
  let leadStddev: number | null = null;
  if (leads.length > 0) {
    leadAvg = leads.reduce((a, b) => a + b, 0) / leads.length;
    const variance = leads.reduce((a, b) => a + (b - (leadAvg as number)) ** 2, 0) / leads.length;
    leadStddev = Math.sqrt(variance);
  }

  return {
    otifPct,
    onTimePct,
    inFullPct,
    leadTimeAvgDays: leadAvg == null ? null : round2(leadAvg),
    leadTimeStddevDays: leadStddev == null ? null : round2(leadStddev),
    sampleSize: n,
  };
}

/** Realized lead time in whole-ish days between order and delivery (≥ 0). */
export function leadTimeDays(orderAt: string | null, deliveryAt: string | null): number | null {
  if (!orderAt || !deliveryAt) return null;
  const o = Date.parse(orderAt);
  const d = Date.parse(deliveryAt);
  if (Number.isNaN(o) || Number.isNaN(d)) return null;
  const days = (d - o) / (24 * 60 * 60 * 1000);
  return days < 0 ? null : Math.round(days * 100) / 100;
}

function dayStart(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function frac(num: number, denom: number): number {
  return Math.round((num / denom) * 10000) / 10000;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
