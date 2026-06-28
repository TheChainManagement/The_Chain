import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Resolver branch coverage (W2-0). The operating-mode read sits in the app shell
 * (BenchGate), so its error + missing-row behavior is load-bearing: a fault must
 * surface, never silently render the wrong mode. A chainable admin-client stub
 * lets us exercise every branch without a live DB.
 */

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const { loadOperatingMode, loadOperatingProfile } = await import('@/lib/modes/resolver');

describe('operating-mode resolver (W2-0)', () => {
  beforeEach(() => maybeSingle.mockReset());

  it('returns the tenant operating_mode', async () => {
    maybeSingle.mockResolvedValue({ data: { operating_mode: 'storeroom' }, error: null });
    expect(await loadOperatingMode('t1')).toBe('storeroom');
  });

  it('resolves the full profile from the mode (one resolver → profile)', async () => {
    maybeSingle.mockResolvedValue({ data: { operating_mode: 'food' }, error: null });
    const profile = await loadOperatingProfile('t1');
    expect(profile.key).toBe('food');
    expect(profile.navLabels['/inventory']).toBe('Stock');
  });

  it('throws on a read error instead of masking it as a default', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(loadOperatingMode('t1')).rejects.toThrow(/loadOperatingMode failed: boom/);
  });

  it('throws on a missing tenant row (corruption, not a benign default)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(loadOperatingMode('t1')).rejects.toThrow(/no tenant row/);
  });
});
