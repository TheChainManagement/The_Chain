/**
 * Forecast batch core (Block 8 Wave 2b) — server-only. All I/O for the durable
 * batch lives here so the workflow files stay pure orchestration.
 *
 * Three units, matching the workflow's step boundaries:
 *
 *  - `planForecastBatch` — counts the catalog, reads the tenant's concurrency
 *    limit, refreshes `category_benchmarks` (trimmed mean of warm SKUs' daily
 *    demand per category — computed BEFORE shards run so cold SKUs fill from a
 *    fresh benchmark), and stamps the plan into `sync_runs.cursor`.
 *
 *  - `runForecastChunk` — forecasts one chunk of a shard's SKU slice: eligibility
 *    from distinct sale-days, method routing from the stored classification
 *    ADI/CV², the Python function call for modeled SKUs, benchmark fills for cold
 *    ones, and idempotent writes to `forecasts` / `forecast_points` /
 *    `forecast_evaluations`. Re-running a chunk skips SKUs that already have a
 *    forecast for this run, so a crash-retry converges instead of double-writing.
 *    (`inventory_policy` is NOT written here — FEATURES Block 9 step 1 adds the
 *    policy derivation step to the shard once the policy math exists.)
 *
 *  - `finalizeForecastBatch` — closes the sync_run with honest totals and stamps
 *    `onboarding_state.first_forecast_ready_at` on a tenant's first batch.
 *
 * Writes go through the service-role admin client (forecast tables are
 * system-write-only; members have SELECT). Authorization happened at the action
 * or cron gate before the workflow started. The parent workflow is the ONLY
 * writer of the sync_runs row (children write forecasts + sync_failures, both
 * insert-only), so progress updates never race.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMAND_WEEKS } from '@/lib/classification/compute';
import {
  callForecastApi,
  type ForecastApiConfig,
  type ForecastResponse,
} from '@/lib/forecast/api-client';
import {
  eligibility,
  eligibilityThresholdMet,
  type ForecastMethod,
  routeForecast,
  WARM_SALE_DAYS,
} from '@/lib/forecast/routing';
import {
  forwardWeeklyDates,
  HORIZON_WEEKS,
  type Movement,
  meanDailyDemand,
  saleDayCount,
  toWeeklySeries,
  trimmedMean,
} from '@/lib/forecast/series';
import { planShards, type ShardPlan } from '@/lib/forecast/shard';
import { demandTypesForMode } from '@/lib/modes/demand';
import type { OperatingMode } from '@/lib/modes/types';
import { FatalError, RetryableError } from '@/lib/source-adapter';

/** Map the routing vocabulary onto the `forecast_method` enum. Croston-SBA IS
 * the SBA variant — the enum splits croston/sba, the router only emits SBA. */
const METHOD_ENUM: Record<ForecastMethod, string> = {
  croston_sba: 'sba',
  tsb: 'tsb',
  auto_ets: 'auto_ets',
  auto_arima: 'auto_arima',
  seasonal_naive: 'seasonal_naive',
  benchmark: 'benchmark',
};

/** Concurrent Python calls inside one chunk step. */
const API_POOL = 4;
const PAGE = 1000;

export interface BatchPlan extends ShardPlan {
  runId: string;
  nowMs: number;
}

export interface ChunkCounts {
  processed: number;
  modeled: number;
  benchmarked: number;
  promoted: number;
  failed: number;
  transitions: number;
}

/**
 * `slice` is how many products the chunk's range actually contained —
 * distinct from `processed` (which is 0 when every SKU already had a forecast
 * for this run). The shard loop stops on a short slice, never on a quiet one,
 * so a resumed run still walks every chunk.
 */
export type ChunkResult = ChunkCounts & { slice: number };

export const ZERO_COUNTS: ChunkCounts = {
  processed: 0,
  modeled: 0,
  benchmarked: 0,
  promoted: 0,
  failed: 0,
  transitions: 0,
};

export function addCounts(a: ChunkCounts, b: ChunkCounts): ChunkCounts {
  return {
    processed: a.processed + b.processed,
    modeled: a.modeled + b.modeled,
    benchmarked: a.benchmarked + b.benchmarked,
    promoted: a.promoted + b.promoted,
    failed: a.failed + b.failed,
    transitions: a.transitions + b.transitions,
  };
}

// ---------------------------------------------------------------- plan

export async function planForecastBatch(
  admin: SupabaseClient,
  params: { tenantId: string; syncRunId: string },
): Promise<BatchPlan> {
  const nowMs = Date.now();

  const [{ count }, { data: tenant }] = await Promise.all([
    admin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)
      .eq('status', 'active'),
    admin
      .from('tenants')
      .select('forecast_concurrency_limit')
      .eq('id', params.tenantId)
      .single<{ forecast_concurrency_limit: number }>(),
  ]);

  const plan = planShards(count ?? 0, tenant?.forecast_concurrency_limit ?? 4);

  await refreshCategoryBenchmarks(admin, params.tenantId, nowMs);

  await admin
    .from('sync_runs')
    .update({
      cursor: {
        kind: 'forecast_batch',
        total: plan.total,
        processed: 0,
        shards: plan.shardCount,
        concurrency: plan.concurrency,
        done: false,
      },
    })
    .eq('id', params.syncRunId);

  return { ...plan, runId: params.syncRunId, nowMs };
}

/**
 * Trimmed mean of warm SKUs' mean daily demand, per `products.attributes.category`.
 * Upserts the fresh snapshot and removes categories that no longer have a warm
 * sample (a stale benchmark is worse than none — cold SKUs would inherit a
 * number computed from SKUs that stopped selling).
 */
export async function refreshCategoryBenchmarks(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<number> {
  const products = await pageAll<{ id: string; attributes: Record<string, unknown> | null }>(
    (from, to) =>
      admin
        .from('products')
        .select('id, attributes')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
  );
  if (products.length === 0) return 0;

  const movementsByProduct = await loadDemandMovements(
    admin,
    tenantId,
    products.map((p) => p.id),
    nowMs,
  );

  const byCategory = new Map<string, number[]>();
  for (const p of products) {
    const category = typeof p.attributes?.category === 'string' ? p.attributes.category.trim() : '';
    if (!category) continue;
    const moves = movementsByProduct.get(p.id) ?? [];
    if (saleDayCount(moves) < WARM_SALE_DAYS) continue;
    const list = byCategory.get(category) ?? [];
    list.push(meanDailyDemand(moves, nowMs));
    byCategory.set(category, list);
  }

  const computedAt = new Date(nowMs).toISOString();
  const rows = [...byCategory.entries()]
    .map(([category, samples]) => ({
      tenant_id: tenantId,
      category,
      trimmed_mean_daily_demand: trimmedMean(samples),
      sample_size: samples.length,
      computed_at: computedAt,
    }))
    .filter((r) => r.trimmed_mean_daily_demand != null);

  if (rows.length > 0) {
    const { error } = await admin
      .from('category_benchmarks')
      .upsert(rows, { onConflict: 'tenant_id,category' });
    if (error) throw new Error(`could not refresh category benchmarks: ${error.message}`);
  }

  // Drop benchmarks whose category lost its warm sample.
  const keep = rows.map((r) => r.category);
  let stale = admin.from('category_benchmarks').delete().eq('tenant_id', tenantId);
  if (keep.length > 0) {
    stale = stale.not('category', 'in', `(${keep.map((c) => `"${c}"`).join(',')})`);
  }
  await stale;

  return rows.length;
}

// ---------------------------------------------------------------- chunk

export interface ChunkParams {
  tenantId: string;
  /** = sync_runs.id; doubles as forecasts.run_id. */
  runId: string;
  shardIndex: number;
  shardSize: number;
  offset: number;
  limit: number;
  nowMs: number;
  /**
   * Explicit SKU targeting (the `recomputeForecast` action). When set, the
   * chunk forecasts exactly these products instead of deriving a slice from
   * (shardIndex, shardSize, offset).
   */
  productIds?: string[];
}

interface ProductSlice {
  id: string;
  sku: string;
  attributes: Record<string, unknown> | null;
}

export async function runForecastChunk(
  admin: SupabaseClient,
  params: ChunkParams,
  api: ForecastApiConfig,
): Promise<ChunkResult> {
  let query = admin
    .from('products')
    .select('id, sku, attributes')
    .eq('tenant_id', params.tenantId)
    .eq('status', 'active')
    .order('id');
  if (params.productIds && params.productIds.length > 0) {
    query = query.in('id', params.productIds);
  } else {
    const start = params.shardIndex * params.shardSize + params.offset;
    query = query.range(start, start + params.limit - 1);
  }
  const { data: products } = await query.returns<ProductSlice[]>();
  if (!products || products.length === 0) return { ...ZERO_COUNTS, slice: 0 };

  const ids = products.map((p) => p.id);

  const [{ data: existing }, movementsByProduct, classByProduct, benchmarks, priorStates] =
    await Promise.all([
      admin
        .from('forecasts')
        .select('product_id')
        .eq('tenant_id', params.tenantId)
        .eq('run_id', params.runId)
        .in('product_id', ids)
        .returns<{ product_id: string }[]>(),
      loadDemandMovements(admin, params.tenantId, ids, params.nowMs),
      loadClassifications(admin, params.tenantId, ids),
      loadBenchmarks(admin, params.tenantId),
      loadPriorStates(admin, params.tenantId, ids, params.runId),
    ]);

  const done = new Set((existing ?? []).map((r) => r.product_id));
  const pending = products.filter((p) => !done.has(p.id));
  if (pending.length === 0) return { ...ZERO_COUNTS, slice: products.length };

  const computedAt = new Date().toISOString();
  const trainingCutoff = new Date(params.nowMs).toISOString();

  interface Prepared {
    product: ProductSlice;
    state: ReturnType<typeof eligibility>;
    method: ForecastMethod;
    response?: ForecastResponse;
    benchmarkDaily?: number | null;
    failure?: { code: string; message: string };
  }

  const prepared: Prepared[] = [];

  // Route + (for modeled SKUs) call the Python function with a small pool.
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(API_POOL, queue.length) }, async () => {
    for (;;) {
      const product = queue.shift();
      if (!product) return;

      const moves = movementsByProduct.get(product.id) ?? [];
      const state = eligibility(saleDayCount(moves));
      const klass = classByProduct.get(product.id);
      const route = routeForecast({
        state,
        adi: klass?.adi ?? null,
        cv2: klass?.cv2 ?? null,
      });

      if (!route.modeled) {
        const category =
          typeof product.attributes?.category === 'string'
            ? product.attributes.category.trim()
            : '';
        prepared.push({
          product,
          state,
          method: 'benchmark',
          benchmarkDaily: category ? (benchmarks.get(category) ?? null) : null,
        });
        continue;
      }

      const series = toWeeklySeries(moves, params.nowMs);
      if (series.length < 2) {
        prepared.push({
          product,
          state,
          method: route.method,
          failure: { code: 'forecast_invalid_input', message: 'fewer than 2 weekly observations' },
        });
        continue;
      }

      try {
        const response = await callForecastApi(api, {
          series,
          h: HORIZON_WEEKS,
          method: route.method as Exclude<ForecastMethod, 'benchmark'>,
          freq: 'W',
          // Annual weekly seasonality needs 2+ years of history; the demand
          // window is capped at DEMAND_WEEKS (52), so the hint stays 1 for now.
          season_length: 1,
          levels: [80, 95],
        });
        prepared.push({ product, state, method: route.method, response });
      } catch (err) {
        if (err instanceof RetryableError) {
          prepared.push({
            product,
            state,
            method: route.method,
            failure: { code: 'forecast_api_retryable', message: err.message },
          });
        } else if (err instanceof FatalError) {
          prepared.push({
            product,
            state,
            method: route.method,
            failure: { code: err.code ?? 'forecast_invalid_input', message: err.message },
          });
        } else {
          throw err;
        }
      }
    }
  });
  await Promise.all(workers);

  // ---- writes. Each SKU's forecast + points + evaluation lands as one BUNDLE
  // through the `insert_forecast_bundles` RPC: one transaction per chunk, so a
  // crash can never leave a forecasts row without its points/evaluation (the
  // skip-done check above is then safe), and the per-run unique index makes a
  // replayed bundle a no-op.

  const counts: ChunkCounts = { ...ZERO_COUNTS };
  const bundles: Record<string, unknown>[] = [];
  const failureRows: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];

  for (const item of prepared) {
    counts.processed++;

    const prior = priorStates.get(item.product.id);
    if (prior && prior !== item.state) {
      counts.transitions++;
      auditRows.push({
        tenant_id: params.tenantId,
        entity_type: 'forecast_eligibility',
        entity_id: item.product.id,
        action: 'eligibility_transition',
        before: { cold_start_state: prior },
        after: { cold_start_state: item.state },
      });
    }

    if (item.failure) {
      counts.failed++;
      failureRows.push({
        tenant_id: params.tenantId,
        sync_run_id: params.runId,
        entity_type: 'forecast',
        external_ref: item.product.sku,
        error_code: item.failure.code,
        payload: { product_id: item.product.id, message: item.failure.message },
      });
      continue;
    }

    const warm = eligibilityThresholdMet(item.state);
    const promoted =
      warm && item.method !== 'benchmark' && item.response?.evaluation.beats_baseline === true;
    if (item.method === 'benchmark') counts.benchmarked++;
    else counts.modeled++;
    if (promoted) counts.promoted++;

    const forecast = {
      tenant_id: params.tenantId,
      product_id: item.product.id,
      location_id: null,
      aggregation_level: 'sku',
      method: METHOD_ENUM[item.method],
      horizon_days: HORIZON_WEEKS * 7,
      confidence_level: 0.95,
      training_cutoff_at: trainingCutoff,
      eligibility_threshold_met: warm,
      cold_start_state: item.state,
      promoted,
      run_id: params.runId,
      computed_at: computedAt,
    };

    let points: Record<string, unknown>[] = [];
    let evaluation: Record<string, unknown> | null = null;

    if (item.response) {
      points = item.response.points.map((p) => ({
        period_date: p.ds,
        mean: p.yhat,
        lower_bound: p.lo95,
        upper_bound: p.hi95,
        lower_bound_80: p.lo80,
        upper_bound_80: p.hi80,
      }));
      evaluation = {
        baseline_method: 'seasonal_naive',
        rolling_origin_windows: item.response.evaluation.n_windows,
        rmsse: item.response.evaluation.rmsse,
        wape: item.response.evaluation.wape,
        beats_baseline: item.response.evaluation.beats_baseline,
        baseline_forecast_values: {
          baseline_rmsse: item.response.evaluation.baseline_rmsse,
          backtest_error: item.response.evaluation.error,
        },
      };
    } else if (item.benchmarkDaily != null) {
      // Cold SKU with a category benchmark: flat weekly fill, no bands, no
      // evaluation (there is no model to backtest).
      const weekly = item.benchmarkDaily * 7;
      points = forwardWeeklyDates(params.nowMs).map((ds) => ({
        period_date: ds,
        mean: weekly,
        lower_bound: null,
        upper_bound: null,
        lower_bound_80: null,
        upper_bound_80: null,
      }));
    }
    // Cold SKU with no category benchmark: the forecasts row records the cold
    // state (the 2c surface reads it as "warming up"); no points exist yet.

    bundles.push({ forecast, points, evaluation });
  }

  if (bundles.length > 0) {
    const { error } = await admin.rpc('insert_forecast_bundles', { p_bundles: bundles });
    if (error) {
      throw new RetryableError(`could not write forecast bundles: ${error.message}`);
    }
  }

  if (failureRows.length > 0) await admin.from('sync_failures').insert(failureRows);
  if (auditRows.length > 0) await admin.from('audit_log').insert(auditRows);

  return { ...counts, slice: products.length };
}

// ---------------------------------------------------------------- finalize

export async function finalizeForecastBatch(
  admin: SupabaseClient,
  params: {
    tenantId: string;
    syncRunId: string;
    totals: ChunkCounts;
    plan: Pick<BatchPlan, 'total' | 'shardCount'>;
    failedShards: number[];
    timedOut: boolean;
    /** 'forecast_single' for the on-demand one-SKU recompute. */
    kind?: 'forecast_batch' | 'forecast_single';
  },
): Promise<void> {
  const succeeded = params.failedShards.length === 0 && !params.timedOut;

  await admin
    .from('sync_runs')
    .update({
      status: succeeded ? 'completed' : 'failed',
      finished_at: new Date().toISOString(),
      cursor: {
        kind: params.kind ?? 'forecast_batch',
        done: true,
        total: params.plan.total,
        processed: params.totals.processed,
        shards: params.plan.shardCount,
        failed_shards: params.failedShards,
        timed_out: params.timedOut,
        totals: { ...params.totals },
      },
      entities_processed: {
        forecasts: params.totals.modeled + params.totals.benchmarked,
        promoted: params.totals.promoted,
        failures: params.totals.failed,
      },
    })
    .eq('id', params.syncRunId);

  // First-forecast trigger (FEATURES Block 1 onboarding contract).
  if (succeeded && params.totals.modeled + params.totals.benchmarked > 0) {
    await admin
      .from('onboarding_state')
      .update({ first_forecast_ready_at: new Date().toISOString() })
      .eq('tenant_id', params.tenantId)
      .is('first_forecast_ready_at', null);
  }
}

/** Parent-only progress + backpressure log writes (single-writer rule). */
export async function recordBatchProgress(
  admin: SupabaseClient,
  syncRunId: string,
  patch: { processed: number; concurrency: number },
): Promise<void> {
  const { data } = await admin
    .from('sync_runs')
    .select('cursor')
    .eq('id', syncRunId)
    .single<{ cursor: Record<string, unknown> | null }>();
  await admin
    .from('sync_runs')
    .update({ cursor: { ...(data?.cursor ?? {}), ...patch } })
    .eq('id', syncRunId);
}

export async function appendBatchLog(
  admin: SupabaseClient,
  syncRunId: string,
  message: string,
): Promise<void> {
  const { data } = await admin
    .from('sync_runs')
    .select('error_log')
    .eq('id', syncRunId)
    .single<{ error_log: unknown[] | null }>();
  await admin
    .from('sync_runs')
    .update({ error_log: [...(data?.error_log ?? []), `${new Date().toISOString()} ${message}`] })
    .eq('id', syncRunId);
}

// ---------------------------------------------------------------- reads

async function loadDemandMovements(
  admin: SupabaseClient,
  tenantId: string,
  productIds: string[],
  nowMs: number,
): Promise<Map<string, Movement[]>> {
  const since = new Date(nowMs - DEMAND_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString();
  // W2-2: demand is mode-routed — sales for distribution, issue_out for a
  // storeroom. Bucketing is Math.abs, so the issue rows' negative sign never
  // reaches the math.
  const { data: tenant } = await admin
    .from('tenants')
    .select('operating_mode')
    .eq('id', tenantId)
    .maybeSingle<{ operating_mode: OperatingMode }>();
  const demandTypes = demandTypesForMode(tenant?.operating_mode ?? null);
  const rows = await pageAll<{
    product_id: string;
    quantity: number | string;
    occurred_at: string;
  }>((from, to) =>
    admin
      .from('stock_movements')
      .select('product_id, quantity, occurred_at')
      .eq('tenant_id', tenantId)
      .in('type', [...demandTypes])
      .gte('occurred_at', since)
      .in('product_id', productIds)
      .order('occurred_at')
      .range(from, to),
  );
  const out = new Map<string, Movement[]>();
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push({ quantity: Number(r.quantity), occurredAt: r.occurred_at });
    out.set(r.product_id, list);
  }
  return out;
}

async function loadClassifications(
  admin: SupabaseClient,
  tenantId: string,
  productIds: string[],
): Promise<Map<string, { adi: number | null; cv2: number | null }>> {
  const { data } = await admin
    .from('product_classifications')
    .select('product_id, adi, cv_squared, computed_at')
    .eq('tenant_id', tenantId)
    .in('product_id', productIds)
    .returns<
      {
        product_id: string;
        adi: number | string | null;
        cv_squared: number | string | null;
        computed_at: string;
      }[]
    >();

  // Same defensive newest-snapshot dedupe as the quadrant read model.
  const newest = new Map<string, { adi: number | null; cv2: number | null; at: string }>();
  for (const r of data ?? []) {
    const prev = newest.get(r.product_id);
    if (prev && prev.at >= r.computed_at) continue;
    newest.set(r.product_id, {
      adi: r.adi == null ? null : Number(r.adi),
      cv2: r.cv_squared == null ? null : Number(r.cv_squared),
      at: r.computed_at,
    });
  }
  return new Map([...newest.entries()].map(([id, v]) => [id, { adi: v.adi, cv2: v.cv2 }]));
}

async function loadBenchmarks(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Map<string, number>> {
  const { data } = await admin
    .from('category_benchmarks')
    .select('category, trimmed_mean_daily_demand')
    .eq('tenant_id', tenantId)
    .returns<{ category: string; trimmed_mean_daily_demand: number | string | null }[]>();
  const out = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.trimmed_mean_daily_demand == null) continue;
    out.set(r.category, Number(r.trimmed_mean_daily_demand));
  }
  return out;
}

/** Latest prior cold_start_state per SKU (for the transition audit). */
async function loadPriorStates(
  admin: SupabaseClient,
  tenantId: string,
  productIds: string[],
  runId: string,
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('forecasts')
    .select('product_id, cold_start_state, computed_at')
    .eq('tenant_id', tenantId)
    .neq('run_id', runId)
    .in('product_id', productIds)
    .order('computed_at', { ascending: false })
    .limit(productIds.length * 4)
    .returns<{ product_id: string; cold_start_state: string; computed_at: string }[]>();
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    if (!out.has(r.product_id)) out.set(r.product_id, r.cold_start_state);
  }
  return out;
}

type PageQuery<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

/** Page through a PostgREST query past the 1000-row response cap. */
async function pageAll<T>(query: PageQuery<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await query(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
