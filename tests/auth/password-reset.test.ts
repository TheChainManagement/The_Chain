import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Password reset (Wave 2 kickoff Item 0): Server Action boundary + the
 * /api/auth/confirm route. Supabase server/admin clients and next/headers are
 * mocked; the assertions pin the contract — enumeration-safe request, validated
 * update under a recovery session, audit write, and confirm-route redirects
 * including the open-redirect guard on `next`.
 */

type AuthResult = { error: { message: string } | null };

const h = vi.hoisted(() => ({
  user: { id: 'u1', email: 'mg@example.com' } as { id: string; email: string } | null,
  resetPasswordForEmail: vi.fn(
    async (_email: string, _opts?: unknown): Promise<AuthResult> => ({ error: null }),
  ),
  updateUser: vi.fn(async (_attrs: unknown): Promise<AuthResult> => ({ error: null })),
  verifyOtp: vi.fn(async (_args: unknown): Promise<AuthResult> => ({ error: null })),
  exchangeCodeForSession: vi.fn(async (_code: string): Promise<AuthResult> => ({ error: null })),
  auditInsert: vi.fn(async (_row: unknown): Promise<AuthResult> => ({ error: null })),
  profile: { active_tenant_id: 't1' } as { active_tenant_id: string | null } | null,
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      resetPasswordForEmail: h.resetPasswordForEmail,
      updateUser: h.updateUser,
      verifyOtp: h.verifyOtp,
      exchangeCodeForSession: h.exchangeCodeForSession,
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    from: (table: string) =>
      table === 'profiles'
        ? {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: h.profile, error: null }) }),
            }),
          }
        : { insert: h.auditInsert },
  }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-host': 'thechain.test', 'x-forwarded-proto': 'https' }),
}));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));

import { requestPasswordReset, updatePassword } from '@/app/(auth)/actions';
import { GET as confirmGet } from '@/app/api/auth/confirm/route';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  h.user = { id: 'u1', email: 'mg@example.com' };
  h.profile = { active_tenant_id: 't1' };
  h.resetPasswordForEmail.mockClear();
  h.resetPasswordForEmail.mockResolvedValue({ error: null });
  h.updateUser.mockClear();
  h.updateUser.mockResolvedValue({ error: null });
  h.verifyOtp.mockClear();
  h.verifyOtp.mockResolvedValue({ error: null });
  h.exchangeCodeForSession.mockClear();
  h.exchangeCodeForSession.mockResolvedValue({ error: null });
  h.auditInsert.mockClear();
  h.redirect.mockClear();
});

describe('requestPasswordReset', () => {
  it('requires an email', async () => {
    const state = await requestPasswordReset(null, form({}));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('email') });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('sends the recovery email with the confirm-route redirect', async () => {
    const state = await requestPasswordReset(null, form({ email: 'mg@example.com' }));
    expect(state).toEqual({ ok: true });
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith('mg@example.com', {
      redirectTo: 'https://thechain.test/api/auth/confirm?next=/reset-password',
    });
  });

  it('stays enumeration-safe: unknown-email errors still return ok', async () => {
    h.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
    const state = await requestPasswordReset(null, form({ email: 'nobody@example.com' }));
    expect(state).toEqual({ ok: true });
  });

  it('surfaces rate limiting honestly', async () => {
    h.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'email rate limit exceeded' },
    });
    const state = await requestPasswordReset(null, form({ email: 'mg@example.com' }));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('Too many') });
  });
});

describe('updatePassword', () => {
  it('rejects short passwords', async () => {
    const state = await updatePassword(null, form({ password: 'abc', confirm: 'abc' }));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('6 characters') });
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirmation', async () => {
    const state = await updatePassword(null, form({ password: 'secret1', confirm: 'secret2' }));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('do not match') });
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it('fails closed without a recovery session', async () => {
    h.user = null;
    const state = await updatePassword(null, form({ password: 'secret1', confirm: 'secret1' }));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('expired') });
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password, audit-logs the recovery, and redirects to /today', async () => {
    await expect(
      updatePassword(null, form({ password: 'secret1', confirm: 'secret1' })),
    ).rejects.toThrow('REDIRECT:/today');
    expect(h.updateUser).toHaveBeenCalledWith({ password: 'secret1' });
    expect(h.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't1',
        actor_user_id: 'u1',
        entity_type: 'auth',
        action: 'auth.password_reset',
      }),
    );
  });

  it('still completes the reset when the account has no tenant yet', async () => {
    h.profile = null;
    await expect(
      updatePassword(null, form({ password: 'secret1', confirm: 'secret1' })),
    ).rejects.toThrow('REDIRECT:/today');
    expect(h.auditInsert).not.toHaveBeenCalled();
  });

  it('maps a Supabase update failure to a friendly error', async () => {
    h.updateUser.mockResolvedValue({
      error: { message: 'New password should be different from the old password.' },
    });
    const state = await updatePassword(null, form({ password: 'secret1', confirm: 'secret1' }));
    expect(state).toEqual({ ok: false, error: expect.stringContaining('already your password') });
  });
});

describe('GET /api/auth/confirm', () => {
  function req(query: string): Request {
    return new Request(`https://thechain.test/api/auth/confirm?${query}`);
  }

  it('verifies a token_hash link and forwards to next', async () => {
    const res = await confirmGet(req('token_hash=th1&type=recovery&next=/reset-password') as never);
    expect(h.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'th1' });
    expect(res.headers.get('location')).toBe('https://thechain.test/reset-password');
  });

  it('exchanges a PKCE code link', async () => {
    const res = await confirmGet(req('code=abc&next=/reset-password') as never);
    expect(h.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(res.headers.get('location')).toBe('https://thechain.test/reset-password');
  });

  it('confines next to same-origin paths (open-redirect guard)', async () => {
    const res = await confirmGet(
      req('token_hash=th1&type=recovery&next=https://evil.example') as never,
    );
    expect(res.headers.get('location')).toBe('https://thechain.test/reset-password');
    const res2 = await confirmGet(req('token_hash=th1&type=recovery&next=//evil.example') as never);
    expect(res2.headers.get('location')).toBe('https://thechain.test/reset-password');
  });

  it('bounces failed verification to the expired notice', async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
    const res = await confirmGet(req('token_hash=th1&type=recovery') as never);
    expect(res.headers.get('location')).toBe(
      'https://thechain.test/forgot-password?error=expired',
    );
  });

  it('bounces links with no credentials at all', async () => {
    const res = await confirmGet(req('next=/reset-password') as never);
    expect(res.headers.get('location')).toBe(
      'https://thechain.test/forgot-password?error=expired',
    );
  });
});
