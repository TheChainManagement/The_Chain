/**
 * Forecast batch — durable orchestration (Block 8, Wave 2b).
 *
 * Two workflows, per the FEATURES fan-out contract:
 *
 *  - `forecastTenantBatchWorkflow` — plans the run, launches up to
 *    `tenants.forecast_concurrency_limit` `forecastShardWorkflow` children at a
 *    time (via `start()` INSIDE a step, never from workflow context), then
 *    polls child status on a durable `sleep` loop. A failed shard halves the
 *    effective concurrency for the rest of the run (backpressure), timestamped
 *    into `sync_runs.error_log`. The parent is the only writer of the
 *    sync_runs row; children only insert forecasts / failures.
 *
 *  - `forecastShardWorkflow` — walks its 200-SKU slice in 25-SKU chunk steps.
 *    Each chunk is the retry unit: idempotent per (tenant, product, run), so a
 *    crash-retry converges. The slice is re-derived from (shardIndex, size)
 *    against the stable product ordering — membership never rides in run state.
 *
 * The `"use workflow"` functions only sequence; ALL I/O (planning, Python
 * calls, DB writes, child start/status) lives in `"use step"` units.
 */

import { sleep } from 'workflow';
import { getRun, start } from 'workflow/api';
import { classifyTenant } from '@/lib/classification/classify';
import { forecastEnv } from '@/lib/env';
import {
  addCounts,
  appendBatchLog,
  type BatchPlan,
  type ChunkCounts,
  type ChunkResult,
  finalizeForecastBatch,
  planForecastBatch,
  recordBatchProgress,
  runForecastChunk,
  ZERO_COUNTS,
} from '@/lib/forecast/batch-core';
import {
  CHUNK_SIZE,
  type ChildState,
  halveConcurrency,
  MAX_POLLS,
  nextLaunches,
  POLL_INTERVAL,
} from '@/lib/forecast/shard';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export interface BatchParams {
  tenantId: string;
  syncRunId: string;
}

export interface ShardParams {
  tenantId: string;
  /** = sync_runs.id of the parent batch run; doubles as forecasts.run_id. */
  runId: string;
  shardIndex: number;
  shardSize: number;
  nowMs: number;
}

export interface BatchSummary extends ChunkCounts {
  total: number;
  shards: number;
  failedShards: number[];
  timedOut: boolean;
}

interface ChildRef {
  shardIndex: number;
  workflowRunId: string;
}

// ---------------------------------------------------------------- steps

async function planBatch(params: BatchParams): Promise<BatchPlan> {
  'use step';
  console.log(`[forecast-batch] plan tenant=${params.tenantId} syncRun=${params.syncRunId}`);
  const plan = await planForecastBatch(createSupabaseAdmin(), params);
  console.log(
    `[forecast-batch] plan total=${plan.total} shards=${plan.shardCount} concurrency=${plan.concurrency}`,
  );
  return plan;
}

/**
 * Refresh ABC/XYZ before the shards route (FEATURES Block 7 step 1: the
 * classification step runs inside the forecast batch). Routing reads the
 * stored ADI/CV² — a stale or missing snapshot would send modeled SKUs to the
 * benchmark path.
 */
async function classifyCatalog(params: BatchParams): Promise<number> {
  'use step';
  const summary = await classifyTenant(createSupabaseAdmin(), params.tenantId);
  console.log(
    `[forecast-batch] classified=${summary.classified} thresholdVersion=${summary.thresholdVersion}`,
  );
  return summary.classified;
}

async function launchShards(input: {
  tenantId: string;
  runId: string;
  shardSize: number;
  nowMs: number;
  indices: number[];
}): Promise<ChildRef[]> {
  'use step';
  const out: ChildRef[] = [];
  for (const shardIndex of input.indices) {
    const run = await start(forecastShardWorkflow, [
      {
        tenantId: input.tenantId,
        runId: input.runId,
        shardIndex,
        shardSize: input.shardSize,
        nowMs: input.nowMs,
      },
    ]);
    out.push({ shardIndex, workflowRunId: run.runId });
  }
  console.log(`[forecast-batch] launched shards=${input.indices.join(',')}`);
  return out;
}

interface PollResult {
  statuses: Array<{ shardIndex: number; status: ChildState }>;
  /** Cumulative retryable forecaster failures (429/5xx/network) this run. */
  retryable: number;
}

async function pollShards(input: {
  syncRunId: string;
  concurrency: number;
  children: ChildRef[];
}): Promise<PollResult> {
  'use step';
  const admin = createSupabaseAdmin();

  const statuses = await Promise.all(
    input.children.map(async (c) => ({
      shardIndex: c.shardIndex,
      status: (await getRun(c.workflowRunId).status) as ChildState,
    })),
  );

  // Coverage-based progress for the UI poller (forecasts written + SKUs
  // dead-lettered this run), plus the retryable-failure count the parent's
  // backpressure watches: FEATURES says halve concurrency on RetryableError,
  // and chunks record those as `forecast_api_retryable` dead-letters rather
  // than failing the whole shard.
  const [{ count: written }, { count: failed }, { count: retryable }] = await Promise.all([
    admin
      .from('forecasts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', input.syncRunId),
    admin
      .from('sync_failures')
      .select('id', { count: 'exact', head: true })
      .eq('sync_run_id', input.syncRunId)
      .eq('entity_type', 'forecast'),
    admin
      .from('sync_failures')
      .select('id', { count: 'exact', head: true })
      .eq('sync_run_id', input.syncRunId)
      .eq('error_code', 'forecast_api_retryable'),
  ]);
  await recordBatchProgress(admin, input.syncRunId, {
    processed: (written ?? 0) + (failed ?? 0),
    concurrency: input.concurrency,
  });

  console.log(
    `[forecast-batch] poll processed=${(written ?? 0) + (failed ?? 0)} retryable=${retryable ?? 0} states=${statuses.map((s) => `${s.shardIndex}:${s.status}`).join(' ')}`,
  );
  return { statuses, retryable: retryable ?? 0 };
}

async function markBatchFailed(input: { syncRunId: string; message: string }): Promise<void> {
  'use step';
  console.log(`[forecast-batch] FAILED syncRun=${input.syncRunId}: ${input.message}`);
  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from('sync_runs')
    .select('error_log')
    .eq('id', input.syncRunId)
    .single<{ error_log: unknown[] | null }>();
  await admin
    .from('sync_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_log: [...(data?.error_log ?? []), `${new Date().toISOString()} ${input.message}`],
    })
    .eq('id', input.syncRunId);
}

async function logBackpressure(input: {
  syncRunId: string;
  reason: string;
  concurrency: number;
}): Promise<void> {
  'use step';
  console.log(`[forecast-batch] backpressure: ${input.reason} → concurrency ${input.concurrency}`);
  await appendBatchLog(
    createSupabaseAdmin(),
    input.syncRunId,
    `${input.reason} — concurrency halved to ${input.concurrency}`,
  );
}

async function collectTotals(children: ChildRef[]): Promise<ChunkCounts> {
  'use step';
  let totals: ChunkCounts = { ...ZERO_COUNTS };
  for (const c of children) {
    // Children passed here are status=completed, so returnValue resolves
    // immediately from the persisted result.
    const counts = (await getRun<ChunkCounts>(c.workflowRunId).returnValue) ?? ZERO_COUNTS;
    totals = addCounts(totals, counts);
  }
  console.log(
    `[forecast-batch] totals shards=${children.length} processed=${totals.processed} promoted=${totals.promoted}`,
  );
  return totals;
}

async function finalizeBatch(input: {
  tenantId: string;
  syncRunId: string;
  totals: ChunkCounts;
  total: number;
  shardCount: number;
  failedShards: number[];
  timedOut: boolean;
}): Promise<void> {
  'use step';
  await finalizeForecastBatch(createSupabaseAdmin(), {
    tenantId: input.tenantId,
    syncRunId: input.syncRunId,
    totals: input.totals,
    plan: { total: input.total, shardCount: input.shardCount },
    failedShards: input.failedShards,
    timedOut: input.timedOut,
  });
  console.log(
    `[forecast-batch] finalize syncRun=${input.syncRunId} processed=${input.totals.processed} promoted=${input.totals.promoted} failedShards=${input.failedShards.length} timedOut=${input.timedOut}`,
  );
}

async function forecastChunk(input: {
  tenantId: string;
  runId: string;
  shardIndex: number;
  shardSize: number;
  offset: number;
  limit: number;
  nowMs: number;
}): Promise<ChunkResult> {
  'use step';
  const env = forecastEnv();
  const result = await runForecastChunk(
    createSupabaseAdmin(),
    {
      tenantId: input.tenantId,
      runId: input.runId,
      shardIndex: input.shardIndex,
      shardSize: input.shardSize,
      offset: input.offset,
      limit: input.limit,
      nowMs: input.nowMs,
    },
    { baseUrl: env.FORECAST_API_URL, secret: env.FORECAST_API_SECRET },
  );
  console.log(
    `[forecast-shard] chunk shard=${input.shardIndex} offset=${input.offset} slice=${result.slice} processed=${result.processed} failed=${result.failed}`,
  );
  return result;
}

// ---------------------------------------------------------------- workflows

export async function forecastShardWorkflow(params: ShardParams): Promise<ChunkCounts> {
  'use workflow';

  let totals: ChunkCounts = { ...ZERO_COUNTS };
  for (let offset = 0; offset < params.shardSize; offset += CHUNK_SIZE) {
    const result = await forecastChunk({
      tenantId: params.tenantId,
      runId: params.runId,
      shardIndex: params.shardIndex,
      shardSize: params.shardSize,
      offset,
      limit: CHUNK_SIZE,
      nowMs: params.nowMs,
    });
    totals = addCounts(totals, result);
    // A short slice means the shard ran past the end of the catalog.
    if (result.slice < CHUNK_SIZE) break;
  }
  return totals;
}

export async function forecastTenantBatchWorkflow(params: BatchParams): Promise<BatchSummary> {
  'use workflow';

  try {
    return await orchestrateBatch(params);
  } catch (err) {
    // A terminally-failed step (exhausted retries) must not leave the run row
    // stuck on 'running' — the UI poller would spin to its cap with no verdict.
    await markBatchFailed({
      syncRunId: params.syncRunId,
      message: err instanceof Error ? err.message : 'forecast batch failed',
    });
    throw err;
  }
}

/** Plain helper inside the workflow context — sequencing only, steps do the I/O. */
async function orchestrateBatch(params: BatchParams): Promise<BatchSummary> {
  const plan = await planBatch(params);
  if (plan.shardCount > 0) await classifyCatalog(params);

  const children: ChildRef[] = [];
  const states = new Map<number, ChildState>();
  const failedShards: number[] = [];
  let concurrency = plan.concurrency;
  let polls = 0;
  let timedOut = false;
  let seenRetryable = 0;

  while (plan.shardCount > 0) {
    const { launch } = nextLaunches(plan.shardCount, states, concurrency);
    if (launch.length > 0) {
      const started = await launchShards({
        tenantId: params.tenantId,
        runId: plan.runId,
        shardSize: plan.shardSize,
        nowMs: plan.nowMs,
        indices: launch,
      });
      for (const ref of started) {
        children.push(ref);
        states.set(ref.shardIndex, 'running');
      }
    }

    const anyActive = [...states.values()].some((s) => s === 'pending' || s === 'running');
    if (states.size >= plan.shardCount && !anyActive) break;

    await sleep(POLL_INTERVAL);
    polls++;

    const poll = await pollShards({ syncRunId: params.syncRunId, concurrency, children });
    for (const s of poll.statuses) {
      const prev = states.get(s.shardIndex);
      states.set(s.shardIndex, s.status);
      const nowFailed = s.status === 'failed' || s.status === 'cancelled';
      const wasFailed = prev === 'failed' || prev === 'cancelled';
      if (nowFailed && !wasFailed) {
        concurrency = halveConcurrency(concurrency);
        failedShards.push(s.shardIndex);
        await logBackpressure({
          syncRunId: params.syncRunId,
          reason: `shard ${s.shardIndex} failed`,
          concurrency,
        });
      }
    }

    // FEATURES backpressure: RetryableErrors (forecaster 429/5xx/network) halve
    // concurrency even though the shard itself keeps going — once per poll
    // cycle in which new retryable failures appeared.
    if (poll.retryable > seenRetryable) {
      const fresh = poll.retryable - seenRetryable;
      seenRetryable = poll.retryable;
      concurrency = halveConcurrency(concurrency);
      await logBackpressure({
        syncRunId: params.syncRunId,
        reason: `${fresh} retryable forecaster failure${fresh === 1 ? '' : 's'}`,
        concurrency,
      });
    }

    if (polls >= MAX_POLLS) {
      timedOut = true;
      break;
    }
  }

  const completed = children.filter((c) => states.get(c.shardIndex) === 'completed');
  const totals = await collectTotals(completed);

  await finalizeBatch({
    tenantId: params.tenantId,
    syncRunId: params.syncRunId,
    totals,
    total: plan.total,
    shardCount: plan.shardCount,
    failedShards,
    timedOut,
  });

  return {
    ...totals,
    total: plan.total,
    shards: plan.shardCount,
    failedShards,
    timedOut,
  };
}
