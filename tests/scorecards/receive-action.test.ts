import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for `markPurchaseOrderReceived` (Block 10): the
 * owner|manager|planner gate, the bad-date guard, the RLS existence check, and
 * the revalidation fan-out. The receive write core is integration-tested
 * separately; here it is mocked.
 */

let rlsQueue: Array<{ data: unknown; error: unknown }> = [];
let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
let receiveMock = vi.fn();
let revalidated: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock('@/lib/scorecards/receive', () => ({
  receivePurchaseOrder: (...args: unknown[]) => receiveMock(...args),
}));
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

const { markPurchaseOrderReceived } = await import('@/app/(app)/purchase-orders/[poId]/actions');

const ok = (data: unknown) => ({ data, error: null });
const INPUT = {
  poId: 'PO1',
  actualDeliveryAt: '2026-06-12T00:00:00Z',
  lines: [{ lineNo: 1, receivedQty: 10 }],
};

beforeEach(() => {
  rlsQueue = [];
  revalidated = [];
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
  receiveMock = vi.fn(async () => ({ ok: true, status: 'received', sampleSize: 6 }));
});
afterEach(() => vi.clearAllMocks());

describe('markPurchaseOrderReceived', () => {
  it('receives + revalidates the PO, cockpit, and supplier surfaces', async () => {
    rlsQueue = [ok({ id: 'PO1', supplier_id: 'S1' })];
    const res = await markPurchaseOrderReceived(INPUT);
    expect(res).toMatchObject({ ok: true, status: 'received' });
    expect(receiveMock).toHaveBeenCalledTimes(1);
    expect(revalidated).toEqual(
      expect.arrayContaining(['/purchase-orders/PO1', '/purchase-orders', '/suppliers/S1', '/suppliers']),
    );
  });

  it('allows a planner', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    rlsQueue = [ok({ id: 'PO1', supplier_id: 'S1' })];
    expect((await markPurchaseOrderReceived(INPUT)).ok).toBe(true);
  });

  it('rejects a viewer before any work', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'viewer', sub: 'U1' };
    expect((await markPurchaseOrderReceived(INPUT)).ok).toBe(false);
    expect(receiveMock).not.toHaveBeenCalled();
  });

  it('rejects a bad delivery date', async () => {
    const res = await markPurchaseOrderReceived({ ...INPUT, actualDeliveryAt: 'not-a-date' });
    expect(res.ok).toBe(false);
    expect(receiveMock).not.toHaveBeenCalled();
  });

  it('404s a PO outside the caller’s tenant (RLS check)', async () => {
    rlsQueue = [ok(null)];
    const res = await markPurchaseOrderReceived(INPUT);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(receiveMock).not.toHaveBeenCalled();
  });
});
