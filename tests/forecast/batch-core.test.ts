import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyTenant } from '@/lib/classification/classify';
import type { ForecastFetch } from '@/lib/forecast/api-client';
import {
  finalizeForecastBatch,
  planForecastBatch,
  runForecastChunk,
} from '@/lib/forecast/batch-core';

/**
 * Forecast batch core (Block 8, Wave 2b) — the admin/service-role path the
 * durable workflow steps run, driven by a scripted forecaster (no Python
 * needed) against the real local Supabase. Proves the slice's contract:
 *
 *  - eligibility from DISTINCT SALE-DAYS routes cold SKUs to a benchmark fill
 *    and never to a model;
 *  - promotion requires BOTH warm eligibility AND beating the baseline;
 *  - the croston_sba routing vocabulary lands as the `sba` enum value;
 *  - a fatal forecaster rejection dead-letters the SKU to sync_failures;
 *  - eligibility transitions are audit-logged;
 *  - a re-run of the same chunk converges (zero new rows) — the crash-retry
 *    contract;
 *  - finalize closes the run and stamps first_forecast_ready_at.
 *
 * Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-forecast-batch@bayou-it.example';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

let tenantId: string;
let locationId: string;
let syncRunId: string;
const productIds = {} as Record<
  'warmSmooth' | 'warmIntermittent' | 'warming' | 'failing' | 'coldWithCategory' | 'coldNoCategory',
  string
>;

/** The scripted forecaster: branch by routed method so each SKU's outcome is exact. */
const scriptedForecaster: ForecastFetch = async (_url, init) => {
  const body = JSON.parse(String(init.body)) as { method: string; h: number };
  if (body.method === 'auto_arima') {
    return new Response(JSON.stringify({ ok: false, error: 'series failed to converge' }), {
      status: 400,
    });
  }
  const beats = body.method !== 'croston_sba';
  const points = Array.from({ length: body.h }, (_, i) => ({
    ds: new Date(NOW + (i + 1) * 7 * DAY).toISOString().slice(0, 10),
    yhat: 21.4 + i * 0.3,
    lo80: 17.2,
    hi80: 25.9,
    lo95: 14.8,
    hi95: 28.3,
  }));
  return new Response(
    JSON.stringify({
      ok: true,
      method: body.method,
      n_obs: 40,
      points,
      evaluation: {
        rmsse: beats ? 0.81 : 1.22,
        wape: 0.23,
        baseline_rmsse: 1.04,
        beats_baseline: beats,
        n_windows: 2,
        error: null,
      },
    }),
    { status: 200 },
  );
};

const API = { baseUrl: 'http://forecast.test', secret: null, fetchImpl: scriptedForecaster };

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

async function insertProduct(
  sku: string,
  category: string | null,
  klass: { adi: number; cv2: number } | null,
): Promise<string> {
  const { data: p } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      sku,
      name: `Bayou ${sku}`,
      attributes: category ? { category } : {},
    })
    .select('id')
    .single<{ id: string }>();
  if (!p) throw new Error(`could not insert ${sku}`);
  if (klass) {
    const { data: ct } = await admin
      .from('classification_thresholds')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    const thresholdId =
      ct?.id ??
      (
        await admin
          .from('classification_thresholds')
          .insert({
            tenant_id: tenantId,
            version: 1,
            abc_cuts: [0.8, 0.95, 1.0],
            xyz_cuts: [0.5, 1.0],
          })
          .select('id')
          .single<{ id: string }>()
      ).data?.id;
    await admin.from('product_classifications').insert({
      tenant_id: tenantId,
      product_id: p.id,
      abc_class: 'A',
      xyz_class: 'Y',
      adi: klass.adi,
      cv_squared: klass.cv2,
      threshold_version_id: thresholdId,
    });
  }
  return p.id;
}

/** Spread `days` distinct sale-days across the trailing year for one SKU. */
async function insertSales(productId: string, days: number, qty = -4): Promise<void> {
  const rows = Array.from({ length: days }, (_, i) => ({
    tenant_id: tenantId,
    product_id: productId,
    location_id: locationId,
    type: 'sale',
    quantity: qty,
    source: 'manual',
    occurred_at: new Date(NOW - (i * 3 + 2) * DAY).toISOString(),
  }));
  const { error } = await admin.from('stock_movements').insert(rows);
  if (error) throw new Error(`could not seed sales: ${error.message}`);
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({
    email: EMAIL,
    password: 'integration-pw',
    email_confirm: true,
  });
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'Forecast Batch Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;

  const { data: loc } = await admin
    .from('locations')
    .insert({ tenant_id: tenantId, name: 'Bayou DC', type: 'warehouse' })
    .select('id')
    .single<{ id: string }>();
  locationId = loc?.id ?? '';

  await admin
    .from('onboarding_state')
    .upsert({ tenant_id: tenantId, path: 'csv' }, { onConflict: 'tenant_id' });

  // The cast: eligibility × routing × outcome, one SKU per branch.
  productIds.warmSmooth = await insertProduct('FRC-1102', 'fasteners', { adi: 1.05, cv2: 0.21 });
  await insertSales(productIds.warmSmooth, 110);
  productIds.warmIntermittent = await insertProduct('FRC-2208', null, { adi: 2.6, cv2: 0.3 });
  await insertSales(productIds.warmIntermittent, 95);
  productIds.warming = await insertProduct('FRC-3301', null, { adi: 1.1, cv2: 0.28 });
  await insertSales(productIds.warming, 45);
  productIds.failing = await insertProduct('FRC-4404', null, { adi: 1.15, cv2: 0.92 });
  await insertSales(productIds.failing, 60);
  productIds.coldWithCategory = await insertProduct('FRC-5505', 'fasteners', null);
  await insertSales(productIds.coldWithCategory, 5);
  productIds.coldNoCategory = await insertProduct('FRC-6606', null, null);
  await insertSales(productIds.coldNoCategory, 3);

  // A prior run's forecast for the warming SKU recorded it as cold → this run
  // must audit-log the cold→warming transition.
  await admin.from('forecasts').insert({
    tenant_id: tenantId,
    product_id: productIds.warming,
    aggregation_level: 'sku',
    method: 'seasonal_naive',
    horizon_days: 56,
    cold_start_state: 'cold',
    run_id: crypto.randomUUID(),
    computed_at: new Date(NOW - 7 * DAY).toISOString(),
  });

  const { data: run } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: null,
      workflow_run_id: `forecast-${Math.round(performance.now())}`,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { kind: 'forecast_batch', done: false },
    })
    .select('id')
    .single<{ id: string }>();
  syncRunId = run?.id ?? '';
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('audit_log').delete().eq('tenant_id', tenantId);
    await admin.from('sync_failures').delete().eq('tenant_id', tenantId);
    await admin.from('sync_runs').delete().eq('tenant_id', tenantId);
    await admin.from('forecast_evaluations').delete().eq('tenant_id', tenantId);
    await admin.from('forecast_points').delete().eq('tenant_id', tenantId);
    await admin.from('forecasts').delete().eq('tenant_id', tenantId);
    await admin.from('category_benchmarks').delete().eq('tenant_id', tenantId);
    await admin.from('product_classifications').delete().eq('tenant_id', tenantId);
    await admin.from('classification_thresholds').delete().eq('tenant_id', tenantId);
    await admin.from('stock_movements').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('onboarding_state').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

async function forecastFor(productId: string) {
  const { data } = await admin
    .from('forecasts')
    .select('id, method, cold_start_state, eligibility_threshold_met, promoted')
    .eq('run_id', syncRunId)
    .eq('product_id', productId)
    .maybeSingle<{
      id: string;
      method: string;
      cold_start_state: string;
      eligibility_threshold_met: boolean;
      promoted: boolean;
    }>();
  return data;
}

describe('forecast batch core — plan → chunk → finalize against real Supabase', () => {
  it('plans the run and refreshes category benchmarks from warm SKUs only', async () => {
    const plan = await planForecastBatch(admin, { tenantId, syncRunId });
    expect(plan).toMatchObject({ total: 6, shardCount: 1, runId: syncRunId });

    const { data: bench } = await admin
      .from('category_benchmarks')
      .select('category, trimmed_mean_daily_demand, sample_size')
      .eq('tenant_id', tenantId)
      .returns<
        { category: string; trimmed_mean_daily_demand: string | number; sample_size: number }[]
      >();
    // Only warmSmooth is warm AND categorized; the cold fasteners SKU must not
    // contribute to its own benchmark.
    expect(bench).toHaveLength(1);
    expect(bench?.[0]).toMatchObject({ category: 'fasteners', sample_size: 1 });
    // 110 sale-days × 4 units over a 364-day window.
    expect(Number(bench?.[0]?.trimmed_mean_daily_demand)).toBeCloseTo((110 * 4) / 364, 2);

    const { data: run } = await admin
      .from('sync_runs')
      .select('cursor')
      .eq('id', syncRunId)
      .single<{ cursor: { total: number; shards: number } }>();
    expect(run?.cursor).toMatchObject({ total: 6, shards: 1 });
  });

  it('forecasts the chunk: routing, promotion, benchmark fills, dead letters', async () => {
    const result = await runForecastChunk(
      admin,
      { tenantId, runId: syncRunId, shardIndex: 0, shardSize: 200, offset: 0, limit: 25, nowMs: NOW },
      API,
    );

    expect(result.slice).toBe(6);
    expect(result.processed).toBe(6);
    expect(result.modeled).toBe(3); // warmSmooth, warmIntermittent, warming
    expect(result.benchmarked).toBe(2); // both cold SKUs
    expect(result.failed).toBe(1); // auto_arima rejection
    expect(result.promoted).toBe(1); // ONLY warmSmooth: warm AND beats baseline

    // Warm + beats baseline → promoted, AutoETS.
    expect(await forecastFor(productIds.warmSmooth)).toMatchObject({
      method: 'auto_ets',
      cold_start_state: 'warm',
      eligibility_threshold_met: true,
      promoted: true,
    });

    // Warm but loses to the baseline → not promoted; croston_sba lands as `sba`.
    expect(await forecastFor(productIds.warmIntermittent)).toMatchObject({
      method: 'sba',
      promoted: false,
      eligibility_threshold_met: true,
    });

    // Beats the baseline but only warming → never promoted.
    expect(await forecastFor(productIds.warming)).toMatchObject({
      cold_start_state: 'warming',
      eligibility_threshold_met: false,
      promoted: false,
    });

    // Cold + categorized → benchmark fill at trimmed-mean × 7, no bands.
    const coldForecast = await forecastFor(productIds.coldWithCategory);
    expect(coldForecast).toMatchObject({ method: 'benchmark', cold_start_state: 'cold' });
    const { data: coldPoints } = await admin
      .from('forecast_points')
      .select('mean, lower_bound, lower_bound_80')
      .eq('forecast_id', coldForecast?.id ?? '')
      .returns<{ mean: string | number; lower_bound: null; lower_bound_80: null }[]>();
    expect(coldPoints).toHaveLength(8);
    expect(Number(coldPoints?.[0]?.mean)).toBeCloseTo(((110 * 4) / 364) * 7, 1);
    expect(coldPoints?.[0]?.lower_bound).toBeNull();
    expect(coldPoints?.[0]?.lower_bound_80).toBeNull();

    // Cold without a category → state recorded, no points to show yet.
    const orphan = await forecastFor(productIds.coldNoCategory);
    expect(orphan?.method).toBe('benchmark');
    const { count: orphanPoints } = await admin
      .from('forecast_points')
      .select('forecast_id', { count: 'exact', head: true })
      .eq('forecast_id', orphan?.id ?? '');
    expect(orphanPoints).toBe(0);

    // The fatal rejection dead-letters with the SKU and reason.
    const { data: failures } = await admin
      .from('sync_failures')
      .select('external_ref, error_code')
      .eq('sync_run_id', syncRunId)
      .returns<{ external_ref: string; error_code: string }[]>();
    expect(failures).toHaveLength(1);
    expect(failures?.[0]).toMatchObject({
      external_ref: 'FRC-4404',
      error_code: 'forecast_invalid_input',
    });

    // No forecast row for the failed SKU.
    expect(await forecastFor(productIds.failing)).toBeNull();
  });

  it('writes the modeled forecast points with both bands and the evaluation verdict', async () => {
    const promoted = await forecastFor(productIds.warmSmooth);
    const { data: points } = await admin
      .from('forecast_points')
      .select('mean, lower_bound, upper_bound, lower_bound_80, upper_bound_80')
      .eq('forecast_id', promoted?.id ?? '')
      .returns<
        {
          mean: string | number;
          lower_bound: string | number;
          upper_bound: string | number;
          lower_bound_80: string | number;
          upper_bound_80: string | number;
        }[]
      >();
    expect(points).toHaveLength(8);
    expect(Number(points?.[0]?.lower_bound)).toBeCloseTo(14.8, 1);
    expect(Number(points?.[0]?.lower_bound_80)).toBeCloseTo(17.2, 1);

    const { data: evaluation } = await admin
      .from('forecast_evaluations')
      .select('rmsse, beats_baseline, rolling_origin_windows')
      .eq('forecast_id', promoted?.id ?? '')
      .single<{ rmsse: string | number; beats_baseline: boolean; rolling_origin_windows: number }>();
    expect(evaluation?.beats_baseline).toBe(true);
    expect(Number(evaluation?.rmsse)).toBeCloseTo(0.81, 2);
  });

  it('audit-logs the eligibility transition (cold → warming) and only that one', async () => {
    const { data: rows } = await admin
      .from('audit_log')
      .select('entity_id, action, before, after')
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'forecast_eligibility')
      .returns<
        {
          entity_id: string;
          action: string;
          before: { cold_start_state: string };
          after: { cold_start_state: string };
        }[]
      >();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      entity_id: productIds.warming,
      action: 'eligibility_transition',
      before: { cold_start_state: 'cold' },
      after: { cold_start_state: 'warming' },
    });
  });

  it('re-running the chunk converges: nothing reprocessed, zero new rows', async () => {
    const before = await admin
      .from('forecasts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', syncRunId);

    const rerun = await runForecastChunk(
      admin,
      { tenantId, runId: syncRunId, shardIndex: 0, shardSize: 200, offset: 0, limit: 25, nowMs: NOW },
      API,
    );
    // The failed SKU has no forecast row, so it (and only it) is retried.
    expect(rerun.slice).toBe(6);
    expect(rerun.processed).toBe(1);
    expect(rerun.failed).toBe(1);

    const after = await admin
      .from('forecasts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', syncRunId);
    expect(after.count).toBe(before.count);
  });

  it('classification recompute survives a SECOND run (the batch classify step)', async () => {
    // Regression: insert-new-then-delete-old violated the partial unique index
    // `product_classifications_uniq_tenant_wide` on every recompute after the
    // first. The atomic snapshot-replace RPC must run back to back cleanly.
    const first = await classifyTenant(admin, tenantId);
    const second = await classifyTenant(admin, tenantId);
    expect(first.classified).toBe(6);
    expect(second.classified).toBe(6);

    const { count } = await admin
      .from('product_classifications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    expect(count).toBe(6); // one snapshot, not stacked duplicates
  });

  it('bundle RPC is atomic: a poisoned bundle leaves no partial forecast behind', async () => {
    const runId = crypto.randomUUID();
    const bundle = {
      forecast: {
        tenant_id: tenantId,
        product_id: productIds.warmSmooth,
        location_id: null,
        aggregation_level: 'sku',
        method: 'auto_ets',
        horizon_days: 56,
        confidence_level: 0.95,
        training_cutoff_at: new Date(NOW).toISOString(),
        eligibility_threshold_met: true,
        cold_start_state: 'warm',
        promoted: true,
        run_id: runId,
        computed_at: new Date(NOW).toISOString(),
      },
      points: [{ period_date: 'not-a-date', mean: 12.5 }], // poison
      evaluation: null,
    };

    const { error } = await admin.rpc('insert_forecast_bundles', { p_bundles: [bundle] });
    expect(error).toBeTruthy();

    const { count } = await admin
      .from('forecasts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId);
    expect(count).toBe(0); // the forecasts insert rolled back with the points
  });

  it('bundle RPC is idempotent: a replayed bundle adds no rows', async () => {
    const runId = crypto.randomUUID();
    const bundle = {
      forecast: {
        tenant_id: tenantId,
        product_id: productIds.warmSmooth,
        location_id: null,
        aggregation_level: 'sku',
        method: 'auto_ets',
        horizon_days: 56,
        confidence_level: 0.95,
        training_cutoff_at: new Date(NOW).toISOString(),
        eligibility_threshold_met: true,
        cold_start_state: 'warm',
        promoted: false,
        run_id: runId,
        computed_at: new Date(NOW).toISOString(),
      },
      points: [
        { period_date: '2026-06-18', mean: 21.4, lower_bound: 14.8, upper_bound: 28.3 },
        { period_date: '2026-06-25', mean: 21.7, lower_bound: 15.1, upper_bound: 28.6 },
      ],
      evaluation: { rmsse: 0.91, wape: 0.2, beats_baseline: false, rolling_origin_windows: 2 },
    };

    const first = await admin.rpc('insert_forecast_bundles', { p_bundles: [bundle] });
    expect(first.error).toBeNull();
    const replay = await admin.rpc('insert_forecast_bundles', { p_bundles: [bundle] });
    expect(replay.error).toBeNull();

    const { data: forecasts } = await admin
      .from('forecasts')
      .select('id')
      .eq('run_id', runId)
      .returns<{ id: string }[]>();
    expect(forecasts).toHaveLength(1);
    const { count: points } = await admin
      .from('forecast_points')
      .select('forecast_id', { count: 'exact', head: true })
      .eq('forecast_id', forecasts?.[0]?.id ?? '');
    expect(points).toBe(2);

    // Clean up so the run-level counts in other tests stay exact.
    await admin.from('forecasts').delete().eq('run_id', runId);
  });

  it('finalize closes the run and stamps first_forecast_ready_at', async () => {
    await finalizeForecastBatch(admin, {
      tenantId,
      syncRunId,
      totals: { processed: 6, modeled: 3, benchmarked: 2, promoted: 1, failed: 1, transitions: 1 },
      plan: { total: 6, shardCount: 1 },
      failedShards: [],
      timedOut: false,
    });

    const { data: run } = await admin
      .from('sync_runs')
      .select('status, finished_at, cursor, entities_processed')
      .eq('id', syncRunId)
      .single<{
        status: string;
        finished_at: string | null;
        cursor: { done: boolean };
        entities_processed: { forecasts: number; promoted: number };
      }>();
    expect(run?.status).toBe('completed');
    expect(run?.finished_at).toBeTruthy();
    expect(run?.cursor.done).toBe(true);
    expect(run?.entities_processed).toMatchObject({ forecasts: 5, promoted: 1 });

    const { data: onboarding } = await admin
      .from('onboarding_state')
      .select('first_forecast_ready_at')
      .eq('tenant_id', tenantId)
      .single<{ first_forecast_ready_at: string | null }>();
    expect(onboarding?.first_forecast_ready_at).toBeTruthy();
  });
});
