import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for `runForecastBatch` / `getForecastBatchProgress`
 * (Block 8 Wave 2b): the owner/manager gate, the pre-created sync_run, the
 * failed-to-start cleanup (no run left stuck on 'running'), and the poller's
 * status mapping — including that it ignores non-forecast runs.
 *
 * `next/cache`, `workflow/api`, and both Supabase clients are mocked.
 */

let adminQueue: Array<{ data: unknown; error: unknown }> = [];
let rlsQueue: Array<{ data: unknown; error: unknown }> = [];
let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
let startMock = vi.fn();
let chunkMock = vi.fn();
let adminUpdates: number;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('workflow/api', () => ({ start: (...args: unknown[]) => startMock(...args) }));
vi.mock('@/workflows/forecast-batch', () => ({ forecastTenantBatchWorkflow: vi.fn() }));
vi.mock('@/lib/env', () => ({
  forecastEnv: () => ({ FORECAST_API_URL: 'http://forecast.test', FORECAST_API_SECRET: null }),
}));
vi.mock('@/lib/forecast/batch-core', () => ({
  runForecastChunk: (...args: unknown[]) => chunkMock(...args),
  finalizeForecastBatch: vi.fn(async () => undefined),
}));
vi.mock('@/lib/policy/derive', () => ({
  derivePoliciesForRun: vi.fn(async () => ({
    policies: 1,
    skippedNoLeadTime: 0,
    skippedNoBands: 0,
  })),
}));
vi.mock('@/lib/locations/validate', () => ({ isActiveTenantLocation: vi.fn(async () => true) }));

function scriptedBuilder(queue: Array<{ data: unknown; error: unknown }>, onUpdate?: () => void) {
  const next = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'insert', 'eq', 'is', 'order', 'limit']) {
    builder[m] = () => builder;
  }
  builder.update = () => {
    onUpdate?.();
    return builder;
  };
  builder.maybeSingle = next;
  builder.single = next;
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    next().then(resolve, reject);
  return builder;
}

// NOTE: no builder spread here — the builder is thenable, and a thenable client
// would make `await createSupabaseServer()` resolve to a queue item instead.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims } }) },
    from: () => scriptedBuilder(rlsQueue),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => scriptedBuilder(adminQueue, () => adminUpdates++),
}));

const { runForecastBatch, getForecastBatchProgress, recomputeForecast } = await import(
  '@/app/(app)/forecasts/actions'
);

const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  adminQueue = [];
  rlsQueue = [];
  adminUpdates = 0;
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
  startMock = vi.fn(async () => ({ runId: 'wf-1' }));
  chunkMock = vi.fn(async () => ({
    processed: 1,
    modeled: 1,
    benchmarked: 0,
    promoted: 1,
    failed: 0,
    transitions: 0,
    slice: 1,
  }));
});
afterEach(() => vi.clearAllMocks());

describe('runForecastBatch — gate + start', () => {
  it('starts the workflow and returns a tracking key for an owner', async () => {
    adminQueue = [ok({ id: 'SR1' })];
    const res = await runForecastBatch({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.trackingKey).toMatch(/^[0-9a-f]{32}$/);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('allows a manager', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'manager', sub: 'U1' };
    adminQueue = [ok({ id: 'SR1' })];
    expect((await runForecastBatch({})).ok).toBe(true);
  });

  it('rejects a planner before any work', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    const res = await runForecastBatch({});
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/owner or manager/) });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    claims = null;
    const res = await runForecastBatch({});
    expect(res.ok).toBe(false);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('marks the pre-created run failed when the workflow refuses to start', async () => {
    adminQueue = [ok({ id: 'SR1' }), ok(null)];
    startMock = vi.fn(async () => {
      throw new Error('no workflow runtime');
    });
    const res = await runForecastBatch({});
    expect(res.ok).toBe(false);
    expect(adminUpdates).toBe(1); // the cleanup update, so the poller never spins
  });
});

describe('recomputeForecast — single-SKU on-demand', () => {
  it('runs one targeted chunk and returns its totals', async () => {
    rlsQueue = [ok({ id: 'P1' })]; // RLS product existence check
    adminQueue = [ok({ id: 'SR9' })]; // pre-created sync_run
    const res = await recomputeForecast({ productId: 'P1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.totals.promoted).toBe(1);
    expect(chunkMock).toHaveBeenCalledTimes(1);
    const [, params] = chunkMock.mock.calls[0] as [unknown, { productIds: string[] }];
    expect(params.productIds).toEqual(['P1']);
  });

  it('rejects a planner before any work', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    const res = await recomputeForecast({ productId: 'P1' });
    expect(res.ok).toBe(false);
    expect(chunkMock).not.toHaveBeenCalled();
  });

  it('targets an explicit active location', async () => {
    rlsQueue = [ok({ id: 'P1' })];
    adminQueue = [ok({ id: 'SR9' })];
    const res = await recomputeForecast({ productId: 'P1', locationId: 'L1' });
    expect(res.ok).toBe(true);
    expect(chunkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productIds: ['P1'], locationId: 'L1' }),
      expect.anything(),
    );
  });

  it('rejects a SKU outside the caller catalog (RLS check)', async () => {
    rlsQueue = [ok(null)];
    const res = await recomputeForecast({ productId: 'P-other-tenant' });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(chunkMock).not.toHaveBeenCalled();
  });

  it('marks the run failed when the chunk throws', async () => {
    rlsQueue = [ok({ id: 'P1' })];
    adminQueue = [ok({ id: 'SR9' }), ok(null)];
    chunkMock = vi.fn(async () => {
      throw new Error('forecaster unreachable');
    });
    const res = await recomputeForecast({ productId: 'P1' });
    expect(res.ok).toBe(false);
    expect(adminUpdates).toBe(1); // the failed-state cleanup write
  });
});

describe('getForecastBatchProgress — poller mapping', () => {
  it('maps a running run with its cursor counters', async () => {
    rlsQueue = [
      ok({
        id: 'SR1',
        status: 'running',
        cursor: { kind: 'forecast_batch', processed: 250, total: 900, shards: 5, concurrency: 4 },
      }),
    ];
    expect(await getForecastBatchProgress({ trackingKey: 'k' })).toEqual({
      status: 'running',
      processed: 250,
      total: 900,
      shards: 5,
      concurrency: 4,
    });
  });

  it('maps a completed run to its totals', async () => {
    rlsQueue = [
      ok({
        id: 'SR1',
        status: 'completed',
        cursor: {
          kind: 'forecast_batch',
          total: 900,
          totals: {
            processed: 900,
            modeled: 700,
            benchmarked: 180,
            promoted: 412,
            failed: 20,
            transitions: 9,
          },
          failed_shards: [],
        },
      }),
    ];
    const res = await getForecastBatchProgress({ trackingKey: 'k' });
    expect(res.status).toBe('completed');
    if (res.status === 'completed') expect(res.totals.promoted).toBe(412);
  });

  it('maps a failed run to a failure message', async () => {
    rlsQueue = [ok({ id: 'SR1', status: 'failed', cursor: { kind: 'forecast_batch' } })];
    expect((await getForecastBatchProgress({ trackingKey: 'k' })).status).toBe('failed');
  });

  it('returns unknown for a missing key', async () => {
    rlsQueue = [ok(null)];
    expect((await getForecastBatchProgress({ trackingKey: 'k' })).status).toBe('unknown');
  });

  it('ignores a run that is not a forecast batch', async () => {
    rlsQueue = [ok({ id: 'SR1', status: 'running', cursor: { kind: 'incremental' } })];
    expect((await getForecastBatchProgress({ trackingKey: 'k' })).status).toBe('unknown');
  });
});
