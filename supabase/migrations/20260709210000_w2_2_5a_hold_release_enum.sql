-- ============================================================
-- W2-2.5a — hold / release movement types (kickoff Item 2)
-- ============================================================
-- The stock-status dimension (Item 2c) posts holds and releases as first-class
-- ledger rows instead of overloading `adjustment`: a hold does NOT change
-- on_hand (the goods are still owned and on the shelf), it moves quantity into
-- the on_hold bucket — so ledger replay must be able to tell the two apart by
-- TYPE, not by reason-code convention.
--
-- MG-locked decision (2026-07-09): held stock still COUNTS in valuation (you
-- own it) and is EXCLUDED from reorder / available-to-promise position.
--
-- Split from the column/kernel migration (20260709210100) deliberately:
-- Postgres cannot USE an enum value in the same transaction that adds it, and
-- the Supabase CLI wraps each migration file in one transaction. The CHECK
-- constraints referencing these values live in the next file.

alter type stock_movement_type add value if not exists 'hold';
alter type stock_movement_type add value if not exists 'release';
