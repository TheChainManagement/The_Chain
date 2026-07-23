import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Action-path coverage for the reorder actions (Block 11): the role gates
 * (manager-only recompute, planner-and-up convert) and the revalidation
 * fan-out. The engines are integration-tested; here they are mocked.
 */

let claims: Record<string, unknown> | null = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
let generateMock = vi.fn();
let convertMock = vi.fn();
let revalidated: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock('@/lib/reorder/generate', () => ({
  generateReorderRecommendations: (...a: unknown[]) => generateMock(...a),
}));
vi.mock('@/lib/reorder/convert', () => ({
  convertRecommendationsToPurchaseRequest: (...a: unknown[]) => convertMock(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: ids.map(() => ({ location_id: 'L1' })),
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/access/location-access', () => ({
  memberCanAccessEveryLocation: async () => true,
  memberCanExecute: async (_admin: unknown, _tenant: string, _user: string, capability: string) => {
    const role = claims?.tenant_role;
    return capability === 'reorder.recompute'
      ? role === 'owner' || role === 'manager'
      : role === 'owner' || role === 'manager' || role === 'planner';
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: { claims } }) } }),
}));

const { recomputeReorders, submitSelectedPurchaseRequest } = await import(
  '@/app/(app)/reorder/actions'
);

beforeEach(() => {
  revalidated = [];
  claims = { tenant_id: 'T1', tenant_role: 'owner', sub: 'U1' };
  generateMock = vi.fn(async () => ({ open: 3, updated: 1, created: 2, expired: 0 }));
  convertMock = vi.fn(async () => ({
    ok: true,
    requisitionId: 'REQ9',
    approvalStatus: 'approved',
    reason: 'within_requester_limit',
    autoApproved: true,
    poId: 'PO9',
    lineCount: 2,
  }));
});
afterEach(() => vi.clearAllMocks());

describe('recomputeReorders — manager gate', () => {
  it('regenerates and returns the summary for a manager', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'manager', sub: 'U1' };
    const res = await recomputeReorders({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary.open).toBe(3);
    expect(revalidated).toContain('/reorder');
  });
  it('rejects a planner (recompute is manager-only)', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    const res = await recomputeReorders({});
    expect(res.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('submitSelectedPurchaseRequest - planner gate', () => {
  it('converts for a planner and revalidates the PO + queue', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'planner', sub: 'U1' };
    const res = await submitSelectedPurchaseRequest({ recommendationIds: ['r1', 'r2'] });
    expect(res).toEqual({
      ok: true,
      destination: 'purchase_order',
      poId: 'PO9',
      requisitionId: 'REQ9',
    });
    expect(revalidated).toEqual(
      expect.arrayContaining(['/reorder', '/purchase-orders', '/purchase-orders/PO9']),
    );
  });
  it('routes an above-authority request to the requisition queue without a PO', async () => {
    convertMock = vi.fn(async () => ({
      ok: true,
      requisitionId: 'REQ10',
      approvalStatus: 'submitted',
      reason: 'requester_limit_exceeded',
      autoApproved: false,
      poId: null,
      lineCount: 2,
    }));
    const res = await submitSelectedPurchaseRequest({ recommendationIds: ['r1', 'r2'] });
    expect(res).toEqual({
      ok: true,
      destination: 'requisition',
      requisitionId: 'REQ10',
      reason: 'requester_limit_exceeded',
    });
    expect(revalidated).not.toContain('/purchase-orders');
  });
  it('rejects a viewer', async () => {
    claims = { tenant_id: 'T1', tenant_role: 'viewer', sub: 'U1' };
    const res = await submitSelectedPurchaseRequest({ recommendationIds: ['r1'] });
    expect(res.ok).toBe(false);
    expect(convertMock).not.toHaveBeenCalled();
  });
  it('surfaces an engine rejection (e.g. mixed supplier)', async () => {
    convertMock = vi.fn(async () => ({ ok: false, error: 'different suppliers' }));
    const res = await submitSelectedPurchaseRequest({ recommendationIds: ['r1', 'r2'] });
    expect(res).toMatchObject({ ok: false });
    expect(revalidated).not.toContain('/reorder');
  });
});
