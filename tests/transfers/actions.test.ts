import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claims: {
    tenant_id: 'tenant-1',
    tenant_role: 'warehouse',
    sub: 'user-1',
  } as Record<string, string> | null,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims: h.claims } }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({ rpc: h.rpc }),
}));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));

import { executeTransfer } from '@/app/(app)/transfers/actions';

const input = {
  productId: 'product-1',
  sourceLocationId: 'location-1',
  destinationLocationId: 'location-2',
  quantity: 12,
  idempotencyKey: 'transfer-key-1',
};

beforeEach(() => {
  h.claims = { tenant_id: 'tenant-1', tenant_role: 'warehouse', sub: 'user-1' };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({
    data: [{ out_applied: true, out_transfer_id: 'transfer-1' }],
    error: null,
  });
  h.revalidatePath.mockClear();
});

describe('executeTransfer action gate', () => {
  it.each(['owner', 'manager', 'warehouse'])('allows %s through the admin RPC', async (role) => {
    h.claims = { tenant_id: 'tenant-1', tenant_role: role, sub: 'user-1' };

    await expect(executeTransfer(input)).resolves.toEqual({
      ok: true,
      applied: true,
      transferId: 'transfer-1',
    });
    expect(h.rpc).toHaveBeenCalledWith('execute_stock_transfer', {
      p_tenant: 'tenant-1',
      p_product: 'product-1',
      p_source: 'location-1',
      p_destination: 'location-2',
      p_quantity: 12,
      p_idempotency_key: 'transfer-key-1',
      p_actor: 'user-1',
    });
  });

  it.each(['planner', 'finance', 'viewer'])('rejects %s before the admin RPC', async (role) => {
    h.claims = { tenant_id: 'tenant-1', tenant_role: role, sub: 'user-1' };

    const result = await executeTransfer(input);

    expect(result).toEqual({ ok: false, error: expect.stringContaining('warehouse operator') });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects a missing session before the admin RPC', async () => {
    h.claims = null;
    await expect(executeTransfer(input)).resolves.toEqual({
      ok: false,
      error: 'Your session expired. Sign in again.',
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
