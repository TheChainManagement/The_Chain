import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for the alert queue (in-app alerts engine): the session
 * gate, the RLS-scoped status transition (only open/acknowledged rows move), and
 * that recompute starts the durable generation workflow.
 */

let claims: Record<string, unknown> | null = { tenant_id: 'T1', sub: 'U1' };
let updateError: unknown = null;
let startMock = vi.fn();
let revalidated: string[] = [];
const updateCalls: Array<{ status: string; inStatuses: string[] }> = [];

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock('workflow/api', () => ({ start: (...a: unknown[]) => startMock(...a) }));
vi.mock('@/workflows/alerts', () => ({ alertGenerationWorkflow: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims } }) },
    from: () => {
      const b: Record<string, unknown> = {};
      let captured = { status: '', inStatuses: [] as string[] };
      b.update = (patch: { status: string }) => {
        captured = { status: patch.status, inStatuses: [] };
        return b;
      };
      b.eq = () => b;
      b.in = (_col: string, vals: string[]) => {
        captured.inStatuses = vals;
        updateCalls.push(captured);
        return Promise.resolve({ error: updateError });
      };
      return b;
    },
  }),
}));

const { acknowledgeAlert, dismissAlert, recomputeAlerts } = await import(
  '@/app/(app)/flow/alerts/actions'
);

beforeEach(() => {
  claims = { tenant_id: 'T1', sub: 'U1' };
  updateError = null;
  startMock = vi.fn(async () => ({ runId: 'run_1' }));
  revalidated = [];
  updateCalls.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe('alert queue actions', () => {
  it('acknowledge moves the row to acknowledged, fenced to open/acknowledged', async () => {
    const res = await acknowledgeAlert('a1');
    expect(res.ok).toBe(true);
    expect(updateCalls[0]).toEqual({
      status: 'acknowledged',
      inStatuses: ['open', 'acknowledged'],
    });
    expect(revalidated).toContain('/flow/alerts');
  });

  it('dismiss moves the row to dismissed', async () => {
    const res = await dismissAlert('a1');
    expect(res.ok).toBe(true);
    expect(updateCalls[0]?.status).toBe('dismissed');
  });

  it('rejects when the session has no tenant', async () => {
    claims = null;
    expect((await acknowledgeAlert('a1')).ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it('surfaces a DB error without throwing', async () => {
    updateError = { message: 'boom' };
    const res = await dismissAlert('a1');
    expect(res.ok).toBe(false);
  });

  it('recompute starts the durable generation workflow', async () => {
    const res = await recomputeAlerts();
    expect(res.ok).toBe(true);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
