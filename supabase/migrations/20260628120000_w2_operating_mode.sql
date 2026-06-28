-- ============================================================
-- The Chain — W2-0 Operating-mode spine
-- Source: docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md (§5, §9)
-- ============================================================
--
-- A per-tenant operating mode. Industry-fitted, set by an operator (NOT
-- self-serve, NOT AI-inferred this wave). Drives nav + terminology via the
-- src/lib/modes profile registry; the forecast / policy / reorder engine stays
-- mode-agnostic (a mode only adapts the demand input + material-flow semantics).
--
-- Additive: a new enum + one column with a default, so every existing tenant
-- reads as 'distribution' (the shipped Wave-1 behavior) with no backfill. Add
-- future modes (manufacturing, clinical, ...) via
-- `alter type operating_mode add value if not exists '...'` + a code profile.

do $$ begin
  create type operating_mode as enum ('distribution', 'storeroom', 'food');
exception when duplicate_object then null;
end $$;

alter table tenants
  add column if not exists operating_mode operating_mode not null default 'distribution';

comment on column tenants.operating_mode is
  'W2-0 operating-mode spine. Industry-fitted mode (distribution|storeroom|food), '
  'set by an operator. Drives nav + terminology via src/lib/modes; the forecast/'
  'policy/reorder engine is mode-agnostic. Profiles live in code (src/lib/modes); '
  'this column only stores the key. Add modes via alter type + a code profile.';
