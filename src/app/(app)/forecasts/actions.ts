'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';
import { forecastEnv } from '@/lib/env';
import {
  type ChunkCounts,
  finalizeForecastBatch,
  runForecastChunk,
} from '@/lib/forecast/batch-core';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { forecastTenantBatchWorkflow } from '@/workflows/forecast-batch';

/**
 * Forecast batch actions (Block 8 Wave 2b).
 *
 * `runForecastBatch` — owner/manager gate (same as the QBO sync + classification
 * actions), pre-creates the sync_run (so the poller finds it with no race, and
 * its id doubles as `forecasts.run_id`), then starts the durable
 * `forecastTenantBatchWorkflow`. Forecast writes are system-only, so the
 * workflow writes via the service-role client — authorized HERE, at the gate.
 *
 * `recomputeForecast` — the FEATURES on-demand single-SKU recompute. One SKU is
 * one synchronous chunk (no workflow): same engine, fresh run id, tracked in a
 * sync_run for history. The 2c chart surface gets the button.
 *
 * `getForecastBatchProgress` — RLS read of the run by tracking key; a caller
 * only ever sees their own tenant's runs.
 */

const PRIVILEGED = new Set(['owner', 'manager']);

export type ForecastBatchResult = { ok: true; trackingKey: string } | { ok: false; error: string };

export type ForecastBatchProgress =
  | { status: 'running'; processed: number; total: number; shards: number; concurrency: number }
  | { status: 'completed'; totals: ChunkCounts; total: number; failedShards: number[] }
  | { status: 'failed'; error: string }
  | { status: 'unknown' };

export async function runForecastBatch(
  _input: Record<string, never> = {},
): Promise<ForecastBatchResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can run the forecast batch.' };
  }

  const admin = createSupabaseAdmin();
  const trackingKey = randomBytes(16).toString('hex');

  const { data: run, error } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: null,
      workflow_run_id: trackingKey,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { kind: 'forecast_batch', done: false, processed: 0, total: 0 },
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !run) {
    return { ok: false, error: 'Could not start the forecast batch. Please try again.' };
  }

  try {
    await start(forecastTenantBatchWorkflow, [{ tenantId, syncRunId: run.id }]);
  } catch (err) {
    await admin
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_log: [err instanceof Error ? err.message : 'workflow failed to start'],
      })
      .eq('id', run.id);
    return { ok: false, error: 'Could not start the forecast batch. Please try again.' };
  }

  return { ok: true, trackingKey };
}

export type RecomputeForecastResult =
  | { ok: true; totals: ChunkCounts }
  | { ok: false; error: string };

export async function recomputeForecast(input: {
  productId: string;
  locationId?: string | null;
}): Promise<RecomputeForecastResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;

  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can recompute a forecast.' };
  }
  if (input.locationId != null) {
    // Schema is location-capable; the engine forecasts tenant-wide until the
    // multi-location wave activates. Refuse honestly instead of ignoring it.
    return { ok: false, error: 'Per-location forecasts arrive with multi-location support.' };
  }

  // RLS-scoped existence check: a caller can only recompute their own SKU.
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', input.productId)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>();
  if (!product) return { ok: false, error: 'That SKU was not found in your catalog.' };

  const admin = createSupabaseAdmin();
  const { data: run, error } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: null,
      workflow_run_id: randomBytes(16).toString('hex'),
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { kind: 'forecast_single', done: false, product_id: input.productId },
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !run) {
    return { ok: false, error: 'Could not start the recompute. Please try again.' };
  }

  try {
    const env = forecastEnv();
    const result = await runForecastChunk(
      admin,
      {
        tenantId,
        runId: run.id,
        shardIndex: 0,
        shardSize: 1,
        offset: 0,
        limit: 1,
        nowMs: Date.now(),
        productIds: [input.productId],
      },
      {
        baseUrl: env.FORECAST_API_URL,
        secret: env.FORECAST_API_SECRET,
        protectionBypass: env.FORECAST_PROTECTION_BYPASS,
      },
    );
    await finalizeForecastBatch(admin, {
      tenantId,
      syncRunId: run.id,
      totals: result,
      plan: { total: result.slice, shardCount: 1 },
      failedShards: [],
      timedOut: false,
      kind: 'forecast_single',
    });
    revalidatePath('/forecasts');
    return { ok: true, totals: result };
  } catch {
    await admin
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_log: ['single-SKU recompute failed'],
      })
      .eq('id', run.id);
    return { ok: false, error: 'Could not recompute that forecast. Please try again.' };
  }
}

export async function getForecastBatchProgress(input: {
  trackingKey: string;
}): Promise<ForecastBatchProgress> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from('sync_runs')
    .select('id, status, cursor')
    .eq('workflow_run_id', input.trackingKey)
    .maybeSingle<{
      id: string;
      status: string;
      cursor: {
        kind?: string;
        total?: number;
        processed?: number;
        shards?: number;
        concurrency?: number;
        failed_shards?: number[];
        totals?: ChunkCounts;
      } | null;
    }>();

  if (data?.cursor?.kind !== 'forecast_batch') return { status: 'unknown' };
  const c = data.cursor ?? {};

  if (data.status === 'failed') {
    return { status: 'failed', error: 'The forecast batch did not finish. Please try again.' };
  }

  if (data.status === 'completed') {
    // The batch wrote out-of-band; refresh the surfaces that read forecasts.
    revalidatePath('/forecasts');
    return {
      status: 'completed',
      totals: c.totals ?? {
        processed: c.processed ?? 0,
        modeled: 0,
        benchmarked: 0,
        promoted: 0,
        failed: 0,
        transitions: 0,
      },
      total: c.total ?? 0,
      failedShards: c.failed_shards ?? [],
    };
  }

  return {
    status: 'running',
    processed: c.processed ?? 0,
    total: c.total ?? 0,
    shards: c.shards ?? 0,
    concurrency: c.concurrency ?? 0,
  };
}
