-- ============================================================
-- Block 9 (Codex round-1) — store the lead-time source on the policy row
-- ============================================================
-- The policy view must show WHICH source the lead time came from (FEATURES
-- Codex line). Recomputing the label at read time can drift from the value the
-- deriver actually used (supplier settings / scorecards change between runs);
-- store the source with the row instead.

alter table inventory_policy
  add column lead_time_source text
  check (lead_time_source in ('supplier', 'scorecard'));
comment on column inventory_policy.lead_time_source is
  'Where lead_time_days_used came from: the configured product_suppliers value '
  'or the empirical supplier scorecard (sample_size >= 5). Stored at derivation '
  'so the label never drifts from the number.';
