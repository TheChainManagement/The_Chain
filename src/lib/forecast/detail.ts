/**
 * Per-SKU forecast read model (Block 8 Wave 2c). RLS-scoped — the forecast
 * tables are tenant-SELECT, so everything reads through the caller's client.
 *
 * Loads the chart's three ingredients: the SKU's latest forecast (with points
 * + evaluation), and its weekly demand history (same bucketing the batch
 * trained on, so the chart shows EXACTLY what the model saw).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibilityLabel } from '@/lib/forecast/routing';
import { type SeriesPoint, toWeeklySeries } from '@/lib/forecast/series';
import { demandTypesForMode } from '@/lib/modes/demand';
import type { OperatingMode } from '@/lib/modes/types';

/** DB method enum → operator label. (sba IS Croston-SBA — see batch-core.) */
const METHOD_LABEL: Record<string, string> = {
  croston: 'Croston',
  sba: 'Croston-SBA',
  tsb: 'TSB',
  auto_ets: 'AutoETS',
  auto_arima: 'AutoARIMA',
  seasonal_naive: 'Seasonal naive',
  benchmark: 'Category benchmark',
};

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

export interface ForecastPointRow {
  ds: string;
  mean: number | null;
  lo95: number | null;
  hi95: number | null;
  lo80: number | null;
  hi80: number | null;
}

export interface ForecastEvaluationRow {
  rmsse: number | null;
  wape: number | null;
  baselineRmsse: number | null;
  beatsBaseline: boolean | null;
  windows: number | null;
}

export interface ForecastDetail {
  product: { id: string; sku: string; name: string; status: string };
  forecast: {
    id: string;
    method: string;
    methodLabel: string;
    coldStartState: 'cold' | 'warming' | 'warm';
    eligibilityLabel: string;
    eligibilityMet: boolean;
    promoted: boolean;
    computedAt: string;
    horizonDays: number;
  } | null;
  points: ForecastPointRow[];
  evaluation: ForecastEvaluationRow | null;
  history: SeriesPoint[];
}

export async function loadForecastDetail(
  supabase: SupabaseClient,
  productId: string,
  nowMs: number,
): Promise<ForecastDetail | null> {
  const { data: product } = await supabase
    .from('products')
    .select('id, sku, name, status')
    .eq('id', productId)
    .maybeSingle<{ id: string; sku: string; name: string; status: string }>();
  if (!product) return null;

  const [{ data: forecast }, movements] = await Promise.all([
    supabase
      .from('forecasts')
      .select(
        'id, method, cold_start_state, eligibility_threshold_met, promoted, computed_at, horizon_days',
      )
      .eq('product_id', productId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        method: string;
        cold_start_state: 'cold' | 'warming' | 'warm';
        eligibility_threshold_met: boolean;
        promoted: boolean;
        computed_at: string;
        horizon_days: number;
      }>(),
    loadAllSales(supabase, productId, nowMs),
  ]);

  const history = toWeeklySeries(movements, nowMs);

  if (!forecast) {
    return { product, forecast: null, points: [], evaluation: null, history };
  }

  const [{ data: points }, { data: evaluation }] = await Promise.all([
    supabase
      .from('forecast_points')
      .select('period_date, mean, lower_bound, upper_bound, lower_bound_80, upper_bound_80')
      .eq('forecast_id', forecast.id)
      .order('period_date')
      .returns<
        {
          period_date: string;
          mean: number | string | null;
          lower_bound: number | string | null;
          upper_bound: number | string | null;
          lower_bound_80: number | string | null;
          upper_bound_80: number | string | null;
        }[]
      >(),
    supabase
      .from('forecast_evaluations')
      .select('rmsse, wape, beats_baseline, rolling_origin_windows, baseline_forecast_values')
      .eq('forecast_id', forecast.id)
      .maybeSingle<{
        rmsse: number | string | null;
        wape: number | string | null;
        beats_baseline: boolean | null;
        rolling_origin_windows: number | null;
        baseline_forecast_values: { baseline_rmsse?: number | null } | null;
      }>(),
  ]);

  return {
    product,
    history,
    forecast: {
      id: forecast.id,
      method: forecast.method,
      methodLabel: methodLabel(forecast.method),
      coldStartState: forecast.cold_start_state,
      eligibilityLabel: eligibilityLabel(forecast.cold_start_state),
      eligibilityMet: forecast.eligibility_threshold_met,
      promoted: forecast.promoted,
      computedAt: forecast.computed_at,
      horizonDays: forecast.horizon_days,
    },
    points: (points ?? []).map((p) => ({
      ds: p.period_date,
      mean: num(p.mean),
      lo95: num(p.lower_bound),
      hi95: num(p.upper_bound),
      lo80: num(p.lower_bound_80),
      hi80: num(p.upper_bound_80),
    })),
    evaluation: evaluation
      ? {
          rmsse: num(evaluation.rmsse),
          wape: num(evaluation.wape),
          baselineRmsse: num(evaluation.baseline_forecast_values?.baseline_rmsse ?? null),
          beatsBaseline: evaluation.beats_baseline,
          windows: evaluation.rolling_origin_windows,
        }
      : null,
  };
}

/**
 * The trust caption under the chart. Honest in every direction: a promoted
 * model states its lift over seasonal-naive; a losing model says so; a
 * benchmark fill never pretends there is a model to judge.
 */
export function liftCaption(method: string, evaluation: ForecastEvaluationRow | null): string {
  if (method === 'benchmark') {
    return 'Category benchmark fill — no model to judge yet.';
  }
  if (!evaluation || evaluation.rmsse == null || evaluation.baselineRmsse == null) {
    return 'Backtest unavailable — not enough history for rolling-origin windows.';
  }
  if (evaluation.baselineRmsse <= 0) {
    return 'Baseline degenerate — lift not computable.';
  }
  const lift = ((evaluation.baselineRmsse - evaluation.rmsse) / evaluation.baselineRmsse) * 100;
  const magnitude = Math.abs(lift).toFixed(1);
  return lift >= 0
    ? `Beats seasonal-naive by ${magnitude}% RMSSE`
    : `Trails seasonal-naive by ${magnitude}% RMSSE — not promoted`;
}

/** Ledger row for the cockpit's forecasted-SKU list. */
export interface ForecastLedgerRow {
  productId: string;
  sku: string;
  name: string;
  method: string;
  methodLabel: string;
  coldStartState: string;
  /** Operator-facing FEATURES copy for the state (ledger tooltip). */
  eligibilityLabel: string;
  promoted: boolean;
  rmsse: number | null;
}

export async function listForecastedSkus(
  supabase: SupabaseClient,
  runId: string,
): Promise<ForecastLedgerRow[]> {
  const { data } = await supabase
    .from('forecasts')
    .select(
      `id, product_id, method, cold_start_state, promoted,
       products ( sku, name ),
       forecast_evaluations ( rmsse )`,
    )
    .eq('run_id', runId)
    .returns<
      {
        id: string;
        product_id: string;
        method: string;
        cold_start_state: string;
        promoted: boolean;
        products: { sku: string; name: string } | null;
        forecast_evaluations: { rmsse: number | string | null }[] | null;
      }[]
    >();

  return (data ?? [])
    .map((r) => ({
      productId: r.product_id,
      sku: r.products?.sku ?? '—',
      name: r.products?.name ?? '—',
      method: r.method,
      methodLabel: methodLabel(r.method),
      coldStartState: r.cold_start_state,
      eligibilityLabel: eligibilityLabel(r.cold_start_state as 'cold' | 'warming' | 'warm'),
      promoted: r.promoted,
      rmsse: num(r.forecast_evaluations?.[0]?.rmsse ?? null),
    }))
    .sort((a, b) => Number(b.promoted) - Number(a.promoted) || a.sku.localeCompare(b.sku));
}

/**
 * Page through ALL trailing-year demand movements (past the PostgREST 1000-row
 * cap) — the chart must show the SAME series the batch trained on, so a
 * high-volume SKU never renders truncated history (Codex 2c round-1). W2-2:
 * demand types are mode-routed (sale vs issue_out), matching the batch read.
 */
async function loadAllSales(
  supabase: SupabaseClient,
  productId: string,
  nowMs: number,
): Promise<Array<{ quantity: number; occurredAt: string }>> {
  const since = new Date(nowMs - 364 * 24 * 60 * 60 * 1000).toISOString();
  const PAGE = 1000;
  // RLS scopes the tenants read to the caller's memberships; the row for the
  // ACTIVE tenant is the one whose id matches the JWT claim.
  const { data: claims } = await supabase.auth.getClaims();
  const activeTenant = claims?.claims?.tenant_id as string | undefined;
  const { data: tenant } = activeTenant
    ? await supabase
        .from('tenants')
        .select('operating_mode')
        .eq('id', activeTenant)
        .maybeSingle<{ operating_mode: OperatingMode }>()
    : { data: null };
  const demandTypes = demandTypesForMode(tenant?.operating_mode ?? null);
  const out: Array<{ quantity: number; occurredAt: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('stock_movements')
      .select('quantity, occurred_at')
      .eq('product_id', productId)
      .in('type', [...demandTypes])
      .gte('occurred_at', since)
      .order('occurred_at')
      .range(from, from + PAGE - 1)
      .returns<{ quantity: number | string; occurred_at: string }[]>();
    if (!data || data.length === 0) break;
    for (const m of data) out.push({ quantity: Number(m.quantity), occurredAt: m.occurred_at });
    if (data.length < PAGE) break;
  }
  return out;
}

function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
