/**
 * Billing plans + status mapping (Block 16). Pure logic — no Stripe SDK, no env,
 * no I/O — so every branch is unit-testable. The server billing modules wire env
 * (price IDs) into these maps.
 *
 * Model: hard paywall, no free trial (MG 2026-06-21). Self-serve Starter/Growth/
 * Pro; Enterprise is contact-only. `comp` is a manual free-access grant.
 */

export type PlanTier = 'starter' | 'growth' | 'pro';

/** App-side subscription status (mirrors the `subscription_status` enum). */
export type AppSubStatus = 'incomplete' | 'active' | 'past_due' | 'canceled' | 'comp';

/** Audit/retention tier each plan maps to (mirrors the `retention_tier` enum). */
export type RetentionTier = 'free' | 'starter' | 'standard' | 'pro' | 'enterprise';

export const PLAN_TIERS: readonly PlanTier[] = ['starter', 'growth', 'pro'] as const;

export function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/** Plan → retention tier (drives the audit-log + stock-movement hot window). */
const TIER_TO_RETENTION: Record<PlanTier, RetentionTier> = {
  starter: 'starter',
  growth: 'standard',
  pro: 'pro',
};

export function retentionForTier(tier: PlanTier): RetentionTier {
  return TIER_TO_RETENTION[tier];
}

/** Display metadata for the gated plan picker. Prices match docs/PRICING_RESEARCH. */
export interface PlanInfo {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
  blurb: string;
  features: readonly string[];
  popular?: boolean;
}

export const PLAN_INFO: readonly PlanInfo[] = [
  {
    tier: 'starter',
    name: 'Starter',
    priceMonthly: 129,
    blurb: 'A single location finding its footing.',
    features: [
      'QuickBooks Online sync',
      'Demand forecasting',
      'Reorder points + safety stock',
      'Supplier scorecards',
      'Up to 2 seats',
    ],
  },
  {
    tier: 'growth',
    name: 'Growth',
    priceMonthly: 299,
    blurb: 'Multi-location operators hitting their stride.',
    features: [
      'Everything in Starter',
      'Multiple locations',
      'Higher SKU + seat limits',
      'Sync conflict resolution',
      'In-app alerts',
    ],
    popular: true,
  },
  {
    tier: 'pro',
    name: 'Pro',
    priceMonthly: 599,
    blurb: 'Multi-entity operations and deep catalogs.',
    features: [
      'Everything in Growth',
      'Multi-entity',
      'Audit-log export',
      'Advanced analytics',
      'Priority support',
    ],
  },
] as const;

/**
 * Whether a subscription status grants access to the product. `comp` (manual free
 * grant) behaves exactly like `active`; everything else is gated to the paywall.
 */
export function hasAppAccess(status: string | null | undefined): boolean {
  return status === 'active' || status === 'comp';
}

/**
 * Map a Stripe subscription status to our app status. Stripe's lifecycle is
 * richer than ours; we collapse it to what the paywall needs.
 */
export function mapStripeStatus(stripeStatus: string): AppSubStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      // 'incomplete' and anything unknown: no access until payment lands.
      return 'incomplete';
  }
}

/** Resolve a Stripe price ID to a plan tier via the env-built map (null if none). */
export function priceIdToTier(
  priceId: string | null | undefined,
  priceMap: Record<PlanTier, string>,
): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PLAN_TIERS) {
    if (priceMap[tier] === priceId) return tier;
  }
  return null;
}
