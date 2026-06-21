import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stripe webhook signature gate (Block 16). The handler must fail closed: no
 * secret → 500, no signature header → 400, bad signature → 400. These run
 * offline (constructEvent is local HMAC crypto), so they guard the security
 * boundary without network. A valid-signature → DB write path is exercised live
 * (see _reviews/2026-06-21_feature_block16_billing.md).
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  // Minimal env so getStripe()/stripeEnv() construct without throwing.
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_GROWTH = 'price_growth';
  process.env.STRIPE_PRICE_PRO = 'price_pro';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function post(body: string, headers: Record<string, string>) {
  const { POST } = await import('@/app/api/webhooks/stripe/route');
  return POST(
    new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers }),
  );
}

describe('stripe webhook — signature gate fails closed', () => {
  it('returns 500 when the webhook secret is unset', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const res = await post('{}', { 'stripe-signature': 'x' });
    expect(res.status).toBe(500);
  });

  it('returns 400 when the signature header is missing', async () => {
    const res = await post('{}', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 on an invalid signature', async () => {
    const res = await post(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }), {
      'stripe-signature': 't=1,v1=deadbeef',
    });
    expect(res.status).toBe(400);
  });
});
