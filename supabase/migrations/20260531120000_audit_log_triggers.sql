-- ============================================================
-- The Chain — Phase 5F: audit log trigger dispatcher
-- Source: FEATURES.md §Wave 1 Foundation step 6 + Codex checklist
--         ("single dispatcher function, not table-specific duplication")
--         SYSTEM_DESIGN.md §Alerts, insights, audit + §ROI (Wave 6)
-- ============================================================
--
-- ONE security-definer dispatcher (`capture_audit`) is attached to every
-- tracked table via the loop at the bottom. Adding a table later = add its name
-- to the `tracked` array; no new function, no copy-pasted trigger body.
--
-- The dispatcher captures the WHOLE row as `before`/`after` jsonb. That single
-- choice guarantees the Wave 6 ROI-critical columns are always present without
-- per-table column lists to drift out of sync:
--   inventory_levels : on_hand, allocated, in_transit, location_id
--   purchase_orders  : status, total, expected_delivery_at, actual_delivery_at, supplier_id
--   stock_movements  : type, quantity, product_id, location_id, occurred_at
--
-- Secrets are stripped from both snapshots by key name (denylist), so OAuth
-- credentials never land in the audit trail even though we capture full rows.
-- ============================================================

create or replace function public.capture_audit()
returns trigger
language plpgsql
security definer
-- Empty search_path is the hardening default for security-definer functions:
-- every object reference below is schema-qualified (public.*, auth.uid()), and
-- built-ins resolve from the always-present pg_catalog.
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb;
  v_entity text;
  k        text;
  -- Columns that must never reach the audit trail, matched by name on any
  -- tracked table (generic, not per-table). `encrypted_credentials` is the only
  -- one that exists today (source_connections); the rest future-proof the rule.
  redacted text[] := array[
    'encrypted_credentials', 'credentials', 'access_token', 'refresh_token',
    'token', 'secret', 'password', 'password_hash', 'api_key'
  ];
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  end if;

  foreach k in array redacted loop
    if v_before is not null then v_before := v_before - k; end if;
    if v_after  is not null then v_after  := v_after  - k; end if;
  end loop;

  -- Identity comes from whichever snapshot exists. Every tracked table has a
  -- NOT NULL tenant_id column. `id` is null for composite-PK tables
  -- (inventory_levels, product_suppliers, inventory_policy, purchase_order_lines,
  -- tenant_members, subscriptions) — that is fine, the full identity lives in
  -- the jsonb snapshot; entity_id is only a convenience index.
  v_row := coalesce(v_after, v_before);

  -- Resolve the LOGICAL table name. On a partitioned table (stock_movements),
  -- the insert routes to a partition and the trigger fires there, so
  -- tg_table_name would be 'stock_movements_2026'. pg_partition_root walks back
  -- to the parent; it returns NULL for plain, non-partitioned tables, hence the
  -- coalesce to tg_table_name.
  v_entity := coalesce(
    (select c.relname
       from pg_catalog.pg_class c
      where c.oid = pg_catalog.pg_partition_root(tg_relid)),
    tg_table_name
  );

  insert into public.audit_log (
    tenant_id, actor_user_id, request_id, entity_type, entity_id, action, before, after
  )
  values (
    (v_row ->> 'tenant_id')::uuid,
    auth.uid(),
    nullif(current_setting('request.id', true), ''),
    v_entity,
    (v_row ->> 'id')::uuid,
    v_entity || '.' || lower(tg_op),
    v_before,
    v_after
  );

  return null;  -- AFTER trigger: return value is ignored.
end;
$$;

comment on function public.capture_audit() is
  'Phase 5F audit dispatcher. Attached to every tracked table; writes a '
  'public.audit_log row with full-row before/after jsonb (secrets redacted by '
  'name). Security-definer so it bypasses audit_log RLS (insert is system-only).';

-- Attach the single dispatcher to every tracked table. Idempotent: drops first.
do $$
declare
  t text;
  tracked text[] := array[
    'products',
    'purchase_orders',
    'purchase_order_lines',
    'inventory_levels',
    'stock_movements',
    'suppliers',
    'product_suppliers',
    'subscriptions',
    'tenant_members',
    'source_connections',
    'reorder_recommendations',
    'inventory_policy',
    'sync_conflicts'
  ];
begin
  foreach t in array tracked loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.capture_audit()',
      'audit_' || t, t
    );
  end loop;
end;
$$;
