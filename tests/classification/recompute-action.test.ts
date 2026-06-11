import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-gate coverage for `recomputeClassifications` (Block 7). The engine is
 * tested separately (pure math); this proves the Server Action's role gate and
 * result mapping. Supabase clients + the engine + next/cache are mocked.
 */

let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner' };
const classifyTenant = vi.fn(async () => ({ classified: 7, thresholdVersion: 1 }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: { claims } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/classification/classify', () => ({
  classifyTenant: (...args: unknown[]) => classifyTenant(...(args as [])),
}));

const { recomputeClassifications } = await import('@/app/(app)/inventory/classification/actions');

beforeEach(() => {
  claims = { tenant_id: 'T1', tenant_role: 'owner' };
});
afterEach(() => vi.clearAllMocks());

describe('recomputeClassifications', () => {
  it('runs the engine and returns the count for an owner', async () => {
    const res = await recomputeClassifications();
    expect(res).toEqual({ ok: true, classified: 7 });
    expect(classifyTenant).toHaveBeenCalledOnce();
  });

  it('runs for a manager too', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'manager' };
    expect((await recomputeClassifications()).ok).toBe(true);
  });

  it('refuses a non-privileged member without running the engine', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'member' };
    const res = await recomputeClassifications();
    expect(res).toEqual({
      ok: false,
      error: 'Only an owner or manager can recompute classification.',
    });
    expect(classifyTenant).not.toHaveBeenCalled();
  });

  it('refuses when the session has no tenant', async () => {
    claims = {};
    expect((await recomputeClassifications()).ok).toBe(false);
    expect(classifyTenant).not.toHaveBeenCalled();
  });
});
