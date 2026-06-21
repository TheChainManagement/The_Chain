#!/usr/bin/env node
/**
 * Stripe product/price seeder for The Chain (Block 16).
 *
 * Idempotent: each price carries a stable `lookup_key`, so re-running reuses the
 * existing price instead of creating duplicates. Prices are the value-band plans
 * locked with MG (2026-06-21): Starter $129 / Growth $299 / Pro $599, monthly.
 * Enterprise is contact-only — no self-serve price.
 *
 * Run:  node --env-file=.env.local scripts/stripe-seed.mjs
 * Then paste the printed STRIPE_PRICE_* lines into .env.local.
 */

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    'STRIPE_SECRET_KEY missing — run with: node --env-file=.env.local scripts/stripe-seed.mjs',
  );
  process.exit(2);
}
if (!key.startsWith('sk_test_')) {
  console.error('Refusing to seed with a non-test key. Use a sk_test_ key.');
  process.exit(2);
}

const stripe = new Stripe(key);

const TIERS = [
  { tier: 'starter', name: 'The Chain — Starter', amount: 12900, lookup: 'chain_starter_monthly' },
  { tier: 'growth', name: 'The Chain — Growth', amount: 29900, lookup: 'chain_growth_monthly' },
  { tier: 'pro', name: 'The Chain — Pro', amount: 59900, lookup: 'chain_pro_monthly' },
];

async function ensurePrice(t) {
  // Reuse an existing active price with this lookup_key if present.
  const existing = await stripe.prices.list({ lookup_keys: [t.lookup], active: true, limit: 1 });
  if (existing.data.length > 0) {
    const p = existing.data[0];
    return { ...t, priceId: p.id, productId: p.product, reused: true };
  }
  const product = await stripe.products.create({
    name: t.name,
    metadata: { tier: t.tier, app: 'the-chain' },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: t.amount,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: t.lookup,
    metadata: { tier: t.tier },
  });
  return { ...t, priceId: price.id, productId: product.id, reused: false };
}

const results = [];
for (const t of TIERS) {
  // Sequential on purpose: cheap, and keeps Stripe rate limits happy.
  results.push(await ensurePrice(t));
}

console.log('\nStripe products/prices:');
for (const r of results) {
  console.log(
    `  ${r.tier.padEnd(8)} ${r.priceId}  ($${(r.amount / 100).toFixed(0)}/mo) ${r.reused ? '[reused]' : '[created]'}`,
  );
}

console.log('\nPaste into .env.local:');
const envName = {
  starter: 'STRIPE_PRICE_STARTER',
  growth: 'STRIPE_PRICE_GROWTH',
  pro: 'STRIPE_PRICE_PRO',
};
for (const r of results) console.log(`${envName[r.tier]}=${r.priceId}`);
console.log('');
