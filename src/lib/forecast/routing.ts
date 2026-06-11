/**
 * Forecast eligibility + method routing (Block 8) — pure, no I/O.
 *
 * Two decisions the forecast batch makes per SKU BEFORE calling the Python
 * `statsforecast` function, both derived from data we already have:
 *
 *  - **Eligibility** (how much demand history exists): cold / warming / warm.
 *    Cold SKUs never get a model prediction — they fall back to a category
 *    benchmark. This gates `promoted` and the `cold_start_state` on `forecasts`.
 *
 *  - **Method routing** (which model fits the demand shape): reuses the ADI/CV²
 *    the Block 7 classification already computed. Intermittent SKUs (ADI ≥ 1.32,
 *    Syntetos-Boylan) go to the Croston family; smooth go to AutoETS; erratic go
 *    to AutoARIMA. The chosen method name is passed to the Python function, which
 *    executes it — the ADI/CV² math lives in ONE place (classification), not two.
 */

import { INTERMITTENT_ADI } from '@/lib/classification/compute';

export type ColdStartState = 'cold' | 'warming' | 'warm';
/** Methods the Python `/api/forecast` function knows how to run. */
export type ForecastMethod =
  | 'croston_sba'
  | 'tsb'
  | 'auto_ets'
  | 'auto_arima'
  | 'seasonal_naive'
  | 'benchmark';

/** Cold-start ladder thresholds, in DISTINCT DAYS that have a sale movement. */
export const WARMING_SALE_DAYS = 30;
export const WARM_SALE_DAYS = 90;
/** CV² above this (among regular-cadence SKUs) reads as erratic, not smooth. */
export const ERRATIC_CV2 = 0.49;

const ELIGIBILITY_LABEL: Record<ColdStartState, string> = {
  cold: 'warming up — using category benchmark',
  warming: 'early signal — confidence limited',
  warm: 'forecasting on full history',
};

/**
 * Eligibility from the DEPTH of demand history — the count of distinct calendar
 * days that carry a `type='sale'` movement, NOT elapsed time since the first sale
 * (one ancient sale must not read as "warm").
 *
 * - cold:    < 30 sale-days → no model, category benchmark, not promoted.
 * - warming: 30–89 sale-days → model runs but not promoted (confidence limited).
 * - warm:    90+ sale-days → eligible; promoted iff it beats the baseline.
 */
export function eligibility(saleDays: number): ColdStartState {
  if (saleDays < WARMING_SALE_DAYS) return 'cold';
  if (saleDays < WARM_SALE_DAYS) return 'warming';
  return 'warm';
}

export function eligibilityThresholdMet(state: ColdStartState): boolean {
  return state === 'warm';
}

/** Operator-facing label for the eligibility state (FEATURES.md copy). */
export function eligibilityLabel(state: ColdStartState): string {
  return ELIGIBILITY_LABEL[state];
}

export interface RouteInputs {
  state: ColdStartState;
  /** From classification; null when there is no demand signal. */
  adi: number | null;
  cv2: number | null;
}

export interface ForecastRoute {
  method: ForecastMethod;
  /** Operator-facing label for the forecast view. */
  label: string;
  /** Whether a real model runs (false → category benchmark only). */
  modeled: boolean;
}

/**
 * Pick the forecast method for one SKU, on the Syntetos-Boylan demand quadrant.
 * Cold SKUs (or those with no demand signal) never get a model.
 *
 * - Intermittent (ADI ≥ 1.32): lumpy (also erratic sizes) → TSB, which handles
 *   obsolescence; otherwise → Croston-SBA.
 * - Regular cadence (ADI < 1.32): smooth (low CV²) → AutoETS; erratic → AutoARIMA.
 *
 * `seasonal_naive` is the baseline vocabulary the Python function always runs to
 * judge a model against; it is never the routed primary.
 */
export function routeForecast(i: RouteInputs): ForecastRoute {
  if (i.state === 'cold' || i.adi == null) {
    return { method: 'benchmark', label: 'Category benchmark', modeled: false };
  }

  const cv2 = i.cv2 ?? 0;

  if (i.adi >= INTERMITTENT_ADI) {
    return cv2 > ERRATIC_CV2
      ? { method: 'tsb', label: 'TSB (lumpy)', modeled: true }
      : { method: 'croston_sba', label: 'Croston-SBA (intermittent)', modeled: true };
  }

  return cv2 > ERRATIC_CV2
    ? { method: 'auto_arima', label: 'AutoARIMA (erratic)', modeled: true }
    : { method: 'auto_ets', label: 'AutoETS (smooth)', modeled: true };
}
