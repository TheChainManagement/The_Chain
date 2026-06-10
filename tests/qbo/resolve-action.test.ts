import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for `resolveSyncConflict` (Block 6 Wave 6.3-C/D).
 *
 * The pure planner is tested separately; this exercises the Server Action's
 * orchestration against a scripted fake Supabase client: the role gate, the
 * pending/not-found/unknown-entity guards, the atomic claim (compare-and-set),
 * the entity write, and — the bit Codex flagged — the zero-rows-affected race
 * where the linked record vanishes mid-resolve and the write is a silent no-op.
 *
 * `next/cache` + both Supabase clients are mocked; the planner runs for real.
 */

// Scripted, mutable per test. Terminal DB ops (maybeSingle / awaited builder)
// shift the next response off this queue in call order.
let adminQueue: Array<{ data: unknown; error: unknown }> = [];
let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: { claims } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => {
    const next = () => Promise.resolve(adminQueue.shift() ?? { data: null, error: null });
    const builder: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'update', 'insert', 'eq', 'in']) {
      builder[m] = () => builder;
    }
    builder.maybeSingle = next;
    builder.single = next;
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      next().then(resolve, reject);
    return builder;
  },
}));

const { resolveSyncConflict } = await import('@/app/(app)/flow/sync-conflicts/actions');

const PRODUCT_CONFLICT = {
  id: 'C1',
  entity_type: 'product',
  entity_id: 'P1',
  local_state: { name: 'Galv Hanger', description: 'd', unitOfMeasure: 'ea', status: 'active' },
  remote_state: {
    name: 'Galvanized Hanger',
    description: 'd',
    unitOfMeasure: 'box',
    status: 'active',
  },
  applied_resolution: 'pending',
};
const ENTITY_ROW = { external_ids: { qbo: '101', qbo_fp: 'old' } };
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  adminQueue = [];
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
});
afterEach(() => vi.clearAllMocks());

describe('resolveSyncConflict — orchestration', () => {
  it('accept_remote: claims, writes the entity, returns ok', async () => {
    adminQueue = [ok(PRODUCT_CONFLICT), ok(ENTITY_ROW), ok([{ id: 'C1' }]), ok([{ id: 'P1' }])];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res).toEqual({ ok: true });
  });

  it('accept_local: still stamps the entity (fp) and returns ok', async () => {
    adminQueue = [ok(PRODUCT_CONFLICT), ok(ENTITY_ROW), ok([{ id: 'C1' }]), ok([{ id: 'P1' }])];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_local' });
    expect(res).toEqual({ ok: true });
  });

  it('merge: full payload resolves ok', async () => {
    adminQueue = [ok(PRODUCT_CONFLICT), ok(ENTITY_ROW), ok([{ id: 'C1' }]), ok([{ id: 'P1' }])];
    const res = await resolveSyncConflict({
      conflictId: 'C1',
      resolution: 'merge',
      mergePayload: {
        name: 'Galv Hanger',
        description: 'd',
        unitOfMeasure: 'box',
        status: 'active',
      },
    });
    expect(res).toEqual({ ok: true });
  });

  it('merge: a missing field choice is rejected before any catalog write', async () => {
    adminQueue = [ok(PRODUCT_CONFLICT)]; // only the conflict load happens before the planner throws
    const res = await resolveSyncConflict({
      conflictId: 'C1',
      resolution: 'merge',
      mergePayload: { name: 'Galv Hanger' },
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a non-owner/manager before touching the database', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'member', sub: 'U2' };
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res).toEqual({
      ok: false,
      error: 'Only an owner or manager can resolve a sync conflict.',
    });
  });

  it('errors when the conflict no longer exists', async () => {
    adminQueue = [ok(null)];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res).toEqual({ ok: false, error: 'That conflict no longer exists.' });
  });

  it('errors when the conflict is already resolved', async () => {
    adminQueue = [ok({ ...PRODUCT_CONFLICT, applied_resolution: 'accept_remote' })];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res).toEqual({ ok: false, error: 'That conflict has already been resolved.' });
  });

  it('loses the claim race (CAS matched 0 rows) → already resolved', async () => {
    // conflict load, entity load, claim returns [] (someone else claimed it first)
    adminQueue = [ok(PRODUCT_CONFLICT), ok(ENTITY_ROW), ok([])];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res).toEqual({ ok: false, error: 'That conflict has already been resolved.' });
  });

  it('THE RACE: entity vanishes between read and write (0 rows, no error) → released + error, not silent success', async () => {
    // conflict, entity, claim ok, entity write matches 0 rows, then claim release.
    adminQueue = [ok(PRODUCT_CONFLICT), ok(ENTITY_ROW), ok([{ id: 'C1' }]), ok([]), ok(null)];
    const res = await resolveSyncConflict({ conflictId: 'C1', resolution: 'accept_remote' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/linked record may have changed/i);
  });
});
