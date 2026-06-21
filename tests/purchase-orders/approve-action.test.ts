import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for `approvePurchaseOrder` (Block 11b): the
 * owner|manager|planner gate, the RLS existence check, the billing gate
 * (past_due / canceled subscriptions can't place new orders), and that an
 * applied approval starts the durable lifecycle workflow. The approve write
 * core is integration-tested separately; here it is mocked.
 */

let rlsQueue: Array<{ data: unknown; error: unknown }> = [];
let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
let approveMock = vi.fn();
let startMock = vi.fn();
let revalidated: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock('workflow/api', () => ({
  resumeHook: vi.fn(async () => {}),
  start: (...args: unknown[]) => startMock(...args),
}));
vi.mock('@/lib/purchase-orders/approve-core', () => ({
  approveAndPushPurchaseOrder: (...args: unknown[]) => approveMock(...args),
}));
vi.mock('@/lib/scorecards/receive', () => ({ receivePurchaseOrder: vi.fn() }));
vi.mock('@/workflows/po-lifecycle', () => ({ purchaseOrderLifecycleWorkflow: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims } }) },
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['from', 'select', 'eq']) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(rlsQueue.shift() ?? { data: null, error: null });
      return b;
    },
  }),
}));

const { approvePurchaseOrder } = await import('@/app/(app)/purchase-orders/[poId]/actions');

const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  rlsQueue = [];
  revalidated = [];
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
  approveMock = vi.fn(async () => ({
    ok: true,
    status: 'exported',
    applied: true,
    wroteToQbo: false,
    reference: 'TC-1',
  }));
  startMock = vi.fn(async () => ({ runId: 'run_1' }));
});
afterEach(() => vi.clearAllMocks());

describe('approvePurchaseOrder', () => {
  it('approves an active tenant and starts the lifecycle workflow', async () => {
    rlsQueue = [ok({ id: 'PO1', supplier_id: 'S1' }), ok({ status: 'active' })];
    const res = await approvePurchaseOrder({ poId: 'PO1' });
    expect(res).toMatchObject({ ok: true, status: 'exported', applied: true });
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(revalidated).toEqual(expect.arrayContaining(['/purchase-orders/PO1', '/suppliers/S1']));
  });

  it('blocks approval when the subscription is past_due (no write, no workflow)', async () => {
    rlsQueue = [ok({ id: 'PO1', supplier_id: 'S1' }), ok({ status: 'past_due' })];
    const res = await approvePurchaseOrder({ poId: 'PO1' });
    expect(res.ok).toBe(false);
    expect(approveMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('does not start the workflow when approval was a no-op replay', async () => {
    rlsQueue = [ok({ id: 'PO1', supplier_id: 'S1' }), ok({ status: 'active' })];
    approveMock = vi.fn(async () => ({
      ok: false,
      error: 'This order has already been approved.',
    }));
    const res = await approvePurchaseOrder({ poId: 'PO1' });
    expect(res.ok).toBe(false);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('rejects a viewer before any work', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'viewer', sub: 'U1' };
    const res = await approvePurchaseOrder({ poId: 'PO1' });
    expect(res.ok).toBe(false);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('404s a PO outside the caller’s tenant', async () => {
    rlsQueue = [ok(null)];
    const res = await approvePurchaseOrder({ poId: 'PO1' });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(approveMock).not.toHaveBeenCalled();
  });
});
