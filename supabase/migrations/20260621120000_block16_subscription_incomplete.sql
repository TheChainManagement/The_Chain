-- ============================================================
-- The Chain — Block 16 (Billing): add the 'incomplete' subscription status.
--
-- Hard paywall, no free trial (MG 2026-06-21). A freshly signed-up tenant has no
-- access until it pays: signup creates an 'incomplete' subscription, and Stripe
-- checkout flips it to 'active'. This adds the enum value; the signup function is
-- rewritten in the next migration (separate txn — a new enum value can't be used
-- in the same transaction that adds it).
-- ============================================================

alter type subscription_status add value if not exists 'incomplete';
