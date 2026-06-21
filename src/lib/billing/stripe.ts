import 'server-only';
import Stripe from 'stripe';
import { stripeEnv } from '@/lib/env';
import type { PlanTier } from './plans';

/**
 * Stripe server client (Block 16). Lazy singleton so importing billing modules
 * from a Server Component doesn't construct the client until a billing path
 * actually runs. Uses the SDK's pinned API version (matches the bundled types).
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(stripeEnv().STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/** Plan tier → Stripe price ID, from env. */
export function priceMap(): Record<PlanTier, string> {
  const e = stripeEnv();
  return {
    starter: e.STRIPE_PRICE_STARTER,
    growth: e.STRIPE_PRICE_GROWTH,
    pro: e.STRIPE_PRICE_PRO,
  };
}
