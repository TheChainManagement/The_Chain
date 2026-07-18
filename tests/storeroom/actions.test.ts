import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W2-2 Server Action boundary (Codex round-1: the "user role claim →
 * service-role RPC → tenant-scoped stock mutation" path was untested). Verifies
 * the actions' own logic — the owner/manager/warehouse gate (MG-locked),
 * validation, actor threading, and RPC call mapping — with the posting cores,
 * admin client, and location resolver mocked. The RPCs themselves are covered
 * by tests/storeroom/rpcs.test.ts against the real schema.
 */

const h = vi.hoisted(() => ({
  claims: {
    tenant_id: 't1',
    tenant_role: 'warehouse',
    sub: 'u1',
  } as Record<string, string> | null,
  postIssue: vi.fn(),
  postAdjustment: vi.fn(),
  postStockHold: vi.fn(),
  closeCycleCount: vi.fn(),
  isActiveTenantLocation: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims: h.claims } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' } }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/access/location-access', () => ({
  memberCanAccessLocation: async () => true,
}));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/storeroom/post', () => ({
  postIssue: h.postIssue,
  postAdjustment: h.postAdjustment,
  closeCycleCount: h.closeCycleCount,
}));
vi.mock('@/lib/inventory/post-movement', () => ({ postStockHold: h.postStockHold }));
vi.mock('@/lib/locations/validate', () => ({
  isActiveTenantLocation: h.isActiveTenantLocation,
}));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));

import { closeCountSession } from '@/app/(app)/inventory/cycle-counts/actions';
import { adjustStock, holdStock, issueStock } from '@/app/(app)/inventory/storeroom-actions';

const issueInput = {
  locationId: 'loc1',
  movement: 'issue_out' as const,
  demandRefType: 'work_order',
  demandRefId: 'WO-1',
  reasonCode: 'maintenance',
  note: 'note',
  lines: [{ productId: 'p1', qty: 3 }],
  idempotencyKey: 'k1',
};

beforeEach(() => {
  h.claims = { tenant_id: 't1', tenant_role: 'warehouse', sub: 'u1' };
  h.postIssue.mockReset();
  h.postIssue.mockResolvedValue({ ok: true, applied: true, lines: 1, totalQty: 3 });
  h.postAdjustment.mockReset();
  h.postAdjustment.mockResolvedValue({ ok: true, applied: true, onHand: 10 });
  h.postStockHold.mockReset();
  h.postStockHold.mockResolvedValue({ ok: true, applied: true, onHand: 10, onHold: 4 });
  h.closeCycleCount.mockReset();
  h.closeCycleCount.mockResolvedValue({
    ok: true,
    applied: true,
    lines: 2,
    movements: 1,
    absVariance: 2,
  });
  h.revalidatePath.mockClear();
  h.isActiveTenantLocation.mockReset();
  h.isActiveTenantLocation.mockResolvedValue(true);
});

describe('issueStock gate (owner/manager/warehouse, MG-locked)', () => {
  it.each(['owner', 'manager', 'warehouse'])('allows %s and threads the actor', async (role) => {
    h.claims = { tenant_id: 't1', tenant_role: role, sub: 'u1' };
    const result = await issueStock(issueInput);
    expect(result).toEqual({ ok: true, lines: 1, totalQty: 3 });
    expect(h.postIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 't1',
        locationId: 'loc1',
        actorUserId: 'u1',
        demandRefType: 'work_order',
        demandRefId: 'WO-1',
        idempotencyKey: 'k1',
      }),
    );
    expect(h.revalidatePath).toHaveBeenCalledWith('/inventory');
  });

  it.each(['planner', 'finance', 'viewer'])('rejects %s before any write', async (role) => {
    h.claims = { tenant_id: 't1', tenant_role: role, sub: 'u1' };
    const result = await issueStock(issueInput);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('permission') });
    expect(h.postIssue).not.toHaveBeenCalled();
  });

  it('rejects a missing session outright', async () => {
    h.claims = null;
    const result = await issueStock(issueInput);
    expect(result.ok).toBe(false);
    expect(h.postIssue).not.toHaveBeenCalled();
  });
});

describe('issueStock validation', () => {
  it('rejects a ref type outside the locked set', async () => {
    const result = await issueStock({ ...issueInput, demandRefType: 'patient' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('issued to') });
    expect(h.postIssue).not.toHaveBeenCalled();
  });

  it('rejects a blank reference, empty lines, and non-positive quantities', async () => {
    expect((await issueStock({ ...issueInput, demandRefId: '  ' })).ok).toBe(false);
    expect((await issueStock({ ...issueInput, lines: [] })).ok).toBe(false);
    expect((await issueStock({ ...issueInput, lines: [{ productId: 'p1', qty: 0 }] })).ok).toBe(
      false,
    );
    expect((await issueStock({ ...issueInput, idempotencyKey: '' })).ok).toBe(false);
    expect(h.postIssue).not.toHaveBeenCalled();
  });

  it('passes an RPC failure through unchanged', async () => {
    h.postIssue.mockResolvedValue({ ok: false, error: 'Could not record the issue.' });
    const result = await issueStock(issueInput);
    expect(result).toEqual({ ok: false, error: 'Could not record the issue.' });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a missing, archived, or cross-tenant location before the service-role write', async () => {
    h.isActiveTenantLocation.mockResolvedValue(false);
    const result = await issueStock({ ...issueInput, locationId: 'other-tenant-location' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/active location/i) });
    expect(h.postIssue).not.toHaveBeenCalled();
  });
});

describe('adjustStock', () => {
  const input = {
    locationId: 'loc1',
    productId: 'p1',
    delta: -2,
    reasonCode: 'damage',
    idempotencyKey: 'k2',
  };

  it('allows warehouse and maps the call', async () => {
    const result = await adjustStock(input);
    expect(result).toEqual({ ok: true, onHand: 10 });
    expect(h.postAdjustment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 't1',
        productId: 'p1',
        delta: -2,
        reasonCode: 'damage',
        actorUserId: 'u1',
      }),
    );
  });

  it('rejects planner before any write', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'planner', sub: 'u1' };
    const result = await adjustStock(input);
    expect(result.ok).toBe(false);
    expect(h.postAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a zero delta and a missing reason', async () => {
    expect((await adjustStock({ ...input, delta: 0 })).ok).toBe(false);
    expect((await adjustStock({ ...input, reasonCode: ' ' })).ok).toBe(false);
    expect(h.postAdjustment).not.toHaveBeenCalled();
  });
});

describe('holdStock', () => {
  const input = {
    locationId: 'loc1',
    productId: 'p1',
    movement: 'hold' as const,
    qty: 4,
    reasonCode: 'qc_hold',
    idempotencyKey: 'k4',
  };

  it.each(['owner', 'manager', 'warehouse'])('allows %s and maps the call', async (role) => {
    h.claims = { tenant_id: 't1', tenant_role: role, sub: 'u1' };
    const result = await holdStock(input);
    expect(result).toEqual({ ok: true, onHand: 10, onHold: 4 });
    expect(h.postStockHold).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 't1',
        locationId: 'loc1',
        productId: 'p1',
        movement: 'hold',
        qty: 4,
        reasonCode: 'qc_hold',
        actorUserId: 'u1',
        idempotencyKey: 'k4',
      }),
    );
    expect(h.revalidatePath).toHaveBeenCalledWith('/inventory');
  });

  it.each(['planner', 'viewer'])('rejects %s before any write', async (role) => {
    h.claims = { tenant_id: 't1', tenant_role: role, sub: 'u1' };
    const result = await holdStock(input);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('permission') });
    expect(h.postStockHold).not.toHaveBeenCalled();
  });

  it('rejects a non-positive quantity before the RPC', async () => {
    expect((await holdStock({ ...input, qty: 0 })).ok).toBe(false);
    expect((await holdStock({ ...input, qty: -2 })).ok).toBe(false);
    expect((await holdStock({ ...input, qty: Number.NaN })).ok).toBe(false);
    expect(h.postStockHold).not.toHaveBeenCalled();
  });

  it('rejects a missing reason, a bad movement, and a missing key before the RPC', async () => {
    expect((await holdStock({ ...input, reasonCode: ' ' })).ok).toBe(false);
    expect((await holdStock({ ...input, movement: 'issue_out' as unknown as 'hold' })).ok).toBe(
      false,
    );
    expect((await holdStock({ ...input, idempotencyKey: '' })).ok).toBe(false);
    expect(h.postStockHold).not.toHaveBeenCalled();
  });

  it('passes a release with its fixed reason through', async () => {
    h.postStockHold.mockResolvedValue({ ok: true, applied: true, onHand: 10, onHold: 0 });
    const result = await holdStock({
      ...input,
      movement: 'release',
      reasonCode: 'release',
    });
    expect(result).toEqual({ ok: true, onHand: 10, onHold: 0 });
    expect(h.postStockHold).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ movement: 'release', reasonCode: 'release' }),
    );
  });

  it('passes an RPC failure through unchanged', async () => {
    h.postStockHold.mockResolvedValue({
      ok: false,
      error: 'That would release more than is currently held.',
    });
    const result = await holdStock(input);
    expect(result).toEqual({
      ok: false,
      error: 'That would release more than is currently held.',
    });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('closeCountSession', () => {
  const input = { sessionId: 's1', idempotencyKey: 'k3' };

  it('allows warehouse, maps the call, and returns the receipt', async () => {
    const result = await closeCountSession(input);
    expect(result).toEqual({ ok: true, lines: 2, movements: 1, absVariance: 2 });
    expect(h.closeCycleCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 't1', sessionId: 's1', actorUserId: 'u1' }),
    );
    expect(h.revalidatePath).toHaveBeenCalledWith('/inventory/cycle-counts');
  });

  it('rejects planner before any write and requires the key', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'planner', sub: 'u1' };
    expect((await closeCountSession(input)).ok).toBe(false);
    h.claims = { tenant_id: 't1', tenant_role: 'warehouse', sub: 'u1' };
    expect((await closeCountSession({ sessionId: 's1', idempotencyKey: '' })).ok).toBe(false);
    expect(h.closeCycleCount).not.toHaveBeenCalled();
  });
});
