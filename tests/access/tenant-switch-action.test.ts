import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshSession: vi.fn(),
  getClaims: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    rpc: h.rpc,
    auth: {
      refreshSession: h.refreshSession,
      getClaims: h.getClaims,
      signOut: h.signOut,
    },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));

import { switchActiveTenant } from '@/app/(app)/tenant-actions';

function input(tenantId = 'tenant-2'): FormData {
  const form = new FormData();
  form.set('tenant_id', tenantId);
  return form;
}

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ error: null });
  h.refreshSession.mockReset().mockResolvedValue({
    data: { session: { access_token: 'fresh-token' } },
    error: null,
  });
  h.getClaims.mockReset().mockResolvedValue({ data: { claims: { tenant_id: 'tenant-2' } } });
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.redirect.mockClear();
});

describe('switchActiveTenant session handoff', () => {
  it('renders the destination only after fresh claims prove the target tenant', async () => {
    await expect(switchActiveTenant(input())).rejects.toThrow('REDIRECT:/today');
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.getClaims).toHaveBeenCalledWith('fresh-token');
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('clears the local session when refresh fails or claims remain on the old tenant', async () => {
    h.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('refresh') });
    h.getClaims.mockResolvedValue({ data: { claims: { tenant_id: 'tenant-1' } } });
    await expect(switchActiveTenant(input())).rejects.toThrow(
      'REDIRECT:/signin?error=tenant_switch_refresh',
    );
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('leaves the current session untouched when the membership-gated RPC rejects', async () => {
    h.rpc.mockResolvedValue({ error: new Error('membership') });
    await expect(switchActiveTenant(input())).resolves.toBeUndefined();
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
