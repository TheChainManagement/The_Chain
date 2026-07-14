/**
 * Forecast batch read model (Block 8 Wave 2b). RLS-scoped: sync_runs and the
 * forecast tables are tenant-SELECT, system-write, so everything here reads
 * through the caller's client.
 *
 * Shapes the `/forecasts` cockpit's overview: the latest batch run (running or
 * finished) plus the eligibility/promotion breakdown of the latest finished run.
 * The per-SKU chart read model lands with the chart itself (wave 2c).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface BatchRunRow {
  syncRunId: string;
  trackingKey: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  shards: number;
  failedShards: number[];
  timedOut: boolean;
}

export interface ForecastStats {
  forecasts: number;
  promoted: number;
  modeled: number;
  benchmarked: number;
  warm: number;
  warming: number;
  cold: number;
  failed: number;
}

export interface ForecastOverview {
  /** A batch currently in flight (the controls resume polling it). */
  running: BatchRunRow | null;
  /** The most recent finished batch (completed or failed). */
  latest: BatchRunRow | null;
  /** Breakdown of the latest finished batch's forecasts. */
  stats: ForecastStats | null;
}

interface RawRun {
  id: string;
  workflow_run_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  cursor: {
    kind?: string;
    total?: number;
    processed?: number;
    shards?: number;
    failed_shards?: number[];
    timed_out?: boolean;
  } | null;
}

function toRun(r: RawRun): BatchRunRow {
  const c = r.cursor ?? {};
  return {
    syncRunId: r.id,
    trackingKey: r.workflow_run_id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    total: c.total ?? 0,
    processed: c.processed ?? 0,
    shards: c.shards ?? 0,
    failedShards: c.failed_shards ?? [],
    timedOut: c.timed_out ?? false,
  };
}

export async function loadForecastOverview(
  supabase: SupabaseClient,
  locationId?: string | null,
): Promise<ForecastOverview> {
  let locationRunId: string | null = null;
  if (locationId) {
    const { data } = await supabase
      .from('forecasts')
      .select('run_id')
      .eq('location_id', locationId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ run_id: string }>();
    locationRunId = data?.run_id ?? null;
  }
  let runsQuery = supabase
    .from('sync_runs')
    .select('id, workflow_run_id, status, started_at, finished_at, cursor')
    .order('started_at', { ascending: false })
    .limit(10);
  if (locationId) {
    if (!locationRunId) return { running: null, latest: null, stats: null };
    runsQuery = runsQuery.eq('id', locationRunId);
  } else {
    runsQuery = runsQuery.eq('cursor->>kind', 'forecast_batch');
  }
  const { data: runs } = await runsQuery.returns<RawRun[]>();

  const running = (runs ?? []).find((r) => r.status === 'running');
  const finished = (runs ?? []).find((r) => r.status === 'completed' || r.status === 'failed');

  let stats: ForecastStats | null = null;
  if (finished) {
    const head = (filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>) =>
      filter(base()).then((r) => r.count ?? 0);
    const base = () => {
      let query = supabase
        .from('forecasts')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', finished.id);
      if (locationId) query = query.eq('location_id', locationId);
      else query = query.is('location_id', null);
      return query;
    };

    const [forecasts, promoted, benchmarked, warm, warming, cold, failedCount] = await Promise.all([
      head((q) => q),
      head((q) => q.eq('promoted', true)),
      head((q) => q.eq('method', 'benchmark')),
      head((q) => q.eq('cold_start_state', 'warm')),
      head((q) => q.eq('cold_start_state', 'warming')),
      head((q) => q.eq('cold_start_state', 'cold')),
      supabase
        .from('sync_failures')
        .select('id', { count: 'exact', head: true })
        .eq('sync_run_id', finished.id)
        .eq('entity_type', 'forecast')
        .then((r) => r.count ?? 0),
    ]);

    stats = {
      forecasts,
      promoted,
      modeled: forecasts - benchmarked,
      benchmarked,
      warm,
      warming,
      cold,
      failed: failedCount,
    };
  }

  return {
    running: running ? toRun(running) : null,
    latest: finished ? toRun(finished) : null,
    stats,
  };
}
