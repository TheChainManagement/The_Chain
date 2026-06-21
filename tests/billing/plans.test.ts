import { describe, expect, it } from 'vitest';
import {
  hasAppAccess,
  isPlanTier,
  mapStripeStatus,
  PLAN_INFO,
  PLAN_TIERS,
  priceIdToTier,
  retentionForTier,
} from '@/lib/billing/plans';

describe('billing/plans — access + status mapping', () => {
  it('grants access only for active and comp', () => {
    expect(hasAppAccess('active')).toBe(true);
    expect(hasAppAccess('comp')).toBe(true);
    for (const s of ['incomplete', 'past_due', 'canceled', 'trial', null, undefined, '']) {
      expect(hasAppAccess(s)).toBe(false);
    }
  });

  it('maps Stripe statuses to app statuses', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('trialing')).toBe('active');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('unpaid')).toBe('past_due');
    expect(mapStripeStatus('paused')).toBe('past_due');
    expect(mapStripeStatus('canceled')).toBe('canceled');
    expect(mapStripeStatus('incomplete_expired')).toBe('canceled');
    expect(mapStripeStatus('incomplete')).toBe('incomplete');
    expect(mapStripeStatus('something_new')).toBe('incomplete');
  });

  it('maps plan tiers to retention tiers', () => {
    expect(retentionForTier('starter')).toBe('starter');
    expect(retentionForTier('growth')).toBe('standard');
    expect(retentionForTier('pro')).toBe('pro');
  });

  it('resolves a price id back to its tier (null when unknown)', () => {
    const map = { starter: 'price_a', growth: 'price_b', pro: 'price_c' } as const;
    expect(priceIdToTier('price_b', map)).toBe('growth');
    expect(priceIdToTier('price_c', map)).toBe('pro');
    expect(priceIdToTier('price_zzz', map)).toBeNull();
    expect(priceIdToTier(null, map)).toBeNull();
    expect(priceIdToTier(undefined, map)).toBeNull();
  });

  it('recognises valid plan tiers', () => {
    expect(isPlanTier('starter')).toBe(true);
    expect(isPlanTier('growth')).toBe(true);
    expect(isPlanTier('pro')).toBe(true);
    expect(isPlanTier('enterprise')).toBe(false);
    expect(isPlanTier('free')).toBe(false);
  });

  it('exposes exactly the three self-serve tiers with locked prices', () => {
    expect(PLAN_TIERS).toEqual(['starter', 'growth', 'pro']);
    const byTier = Object.fromEntries(PLAN_INFO.map((p) => [p.tier, p.priceMonthly]));
    expect(byTier).toEqual({ starter: 129, growth: 299, pro: 599 });
    // Growth is the single highlighted tier.
    expect(PLAN_INFO.filter((p) => p.popular)).toHaveLength(1);
    expect(PLAN_INFO.find((p) => p.popular)?.tier).toBe('growth');
  });
});
