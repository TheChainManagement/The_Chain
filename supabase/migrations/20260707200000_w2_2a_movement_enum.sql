-- ============================================================
-- W2-2a — movement-enum completion (kickoff Item 1)
-- ============================================================
-- Adds the storeroom issue pair plus the two return types, completing the
-- ledger vocabulary in ONE enum migration so W2-3 procurement and the returns
-- UI (which can lag) never force a second one. Spec:
-- docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md §10 + kickoff Item 1 audit additions.
--
-- Split from the column/RPC migration (20260707200100) deliberately: Postgres
-- cannot USE an enum value in the same transaction that adds it, and the
-- Supabase CLI wraps each migration file in one transaction. The CHECK
-- constraints referencing these values live in the next file.

alter type stock_movement_type add value if not exists 'issue_out';
alter type stock_movement_type add value if not exists 'issue_return';
alter type stock_movement_type add value if not exists 'return_to_vendor';
alter type stock_movement_type add value if not exists 'customer_return';
