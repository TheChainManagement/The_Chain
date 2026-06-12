import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for `savePolicyDefault` (Block 9): the owner/manager
 * gate, the RLS existence check, service-level clamping before the write, the
 * engine recompute after it, and the no-policy guard.
 */

let rlsQueue: Array<{ data: unknown; error: unknown }> = [];
let adminQueue: Array<{ data: unknown; error: unknown }> = [];
let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
let deriveMock = vi.fn();
let adminUpdatePayloads: Record<string, unknown>[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/policy/derive', () => ({
  derivePoliciesForRun: (...args: unknown[]) => deriveMock(...args),
}));

function scriptedBuilder(queue: Array<{ data: unknown; error: unknown }>) {
  const next = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'limit']) {
    builder[m] = () => builder;
  }
  builder.update = (payload: Record<string, unknown>) => {
    adminUpdatePayloads.push(payload);
    return builder;
  };
  builder.maybeSingle = next;
  builder.single = next;
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    next().then(resolve, reject);
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims } }) },
    from: () => scriptedBuilder(rlsQueue),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => scriptedBuilder(adminQueue),
}));

const { savePolicyDefault } = await import('@/app/(app)/inventory/policy/actions');

const ok = (data: unknown) => ({ data, error: null });
const POLICY = {
  product_id: 'P1',
  location_id: 'L1',
  based_on_forecast_id: 'F1',
  forecasts: { run_id: 'R1' },
};

beforeEach(() => {
  rlsQueue = [];
  adminQueue = [];
  adminUpdatePayloads = [];
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
  deriveMock = vi.fn(async () => ({ policies: 1, skippedNoLeadTime: 0, skippedNoBands: 0 }));
});
afterEach(() => vi.clearAllMocks());

describe('savePolicyDefault — the bench’s only write path', () => {
  it('clamps the level, writes it, then reruns the derivation engine', async () => {
    rlsQueue = [ok(POLICY)];
    adminQueue = [ok(null)]; // the update
    const res = await savePolicyDefault({ productId: 'P1', locationId: 'L1', serviceLevel: 0.999 });
    expect(res).toEqual({ ok: true });
    expect(adminUpdatePayloads[0]).toMatchObject({ service_level: 0.995 }); // clamped
    expect(deriveMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'T1',
      runId: 'R1',
      productIds: ['P1'],
    });
  });

  it('rejects a planner before any work', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    const res = await savePolicyDefault({ productId: 'P1', locationId: 'L1', serviceLevel: 0.95 });
    expect(res.ok).toBe(false);
    expect(deriveMock).not.toHaveBeenCalled();
    expect(adminUpdatePayloads).toHaveLength(0);
  });

  it('refuses when the SKU has no policy yet (RLS-scoped check)', async () => {
    rlsQueue = [ok(null)];
    const res = await savePolicyDefault({ productId: 'P1', locationId: 'L1', serviceLevel: 0.95 });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/No policy/) });
  });

  it('surfaces a recompute failure instead of pretending', async () => {
    rlsQueue = [ok(POLICY)];
    adminQueue = [ok(null)];
    deriveMock = vi.fn(async () => {
      throw new Error('engine down');
    });
    const res = await savePolicyDefault({ productId: 'P1', locationId: 'L1', serviceLevel: 0.95 });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/recompute failed/) });
  });
});
