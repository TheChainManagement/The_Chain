-- ============================================================
-- The Chain — Phase 6 Block 5 (Wave 5.2): supplier + stock-movement import writers
-- Source: FEATURES.md §"CSV import" steps 3/7/8 + _reviews/_tickets.md Wave 5.2.
--
-- Wave 5.1 shipped the product writer (idempotent on the existing
-- products.unique(tenant_id, sku)). Suppliers and movements have no such key, so
-- this migration adds the two idempotency anchors the writers upsert against, plus
-- the case-insensitive supplier upsert RPC (supabase-js ON CONFLICT can only name
-- columns, not the lower(name) expression index, so the upsert lives in SQL —
-- same atomic-RPC pattern as Block 4's link_supplier).
-- ============================================================

-- ----- Supplier idempotency: case-insensitive natural key (tenant_id, name) -----
-- Re-importing "Acme" / "acme" updates the same supplier instead of duplicating.
-- A guard for the RPC's ON CONFLICT inference below.
create unique index if not exists suppliers_tenant_lower_name_uniq
  on suppliers (tenant_id, lower(name));

-- ----- Movement idempotency: content-addressed source_ref -----
-- stock_movements is append-only and partitioned by occurred_at, so a unique
-- index MUST include the partition key. The CSV writer fills source_ref with a
-- content hash of (sku, type, quantity, occurred_at); re-uploading the same file
-- collides on this key and the writer's ON CONFLICT DO NOTHING skips the dupes.
-- source_ref stays NULL for manual/QBO movements (NULLs are distinct → no dedup
-- for those paths, which is correct).
create unique index if not exists stock_movements_csv_dedup_uniq
  on stock_movements (tenant_id, source, source_ref, occurred_at);

-- ----- import_suppliers: case-insensitive idempotent bulk upsert -----
-- SECURITY INVOKER (default): RLS suppliers_insert/update apply, so the
-- has_role('owner','manager','planner') gate is enforced for the caller and a
-- caller cannot target another tenant (tenant_id = jwt_tenant_id()).
-- search_path = '' per the 5K hardening convention (fully-qualified refs).
-- Caller is responsible for de-duplicating rows by lower(name) before the call
-- (Postgres rejects an ON CONFLICT that would touch the same row twice); the pure
-- mapRows layer does this via the supplier natural key's caseFold flag.
create or replace function public.import_suppliers(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with input as (
    select
      r.name,
      r.default_lead_time_days,
      r.min_order_value,
      coalesce(r.status, 'active')::public.supplier_status as status
    from jsonb_to_recordset(p_rows) as r(
      name text,
      default_lead_time_days int,
      min_order_value numeric,
      status text
    )
  ),
  upserted as (
    insert into public.suppliers
      (tenant_id, name, default_lead_time_days, min_order_value, status, external_ids)
    select
      public.jwt_tenant_id(),
      i.name,
      i.default_lead_time_days,
      i.min_order_value,
      i.status,
      jsonb_build_object('csv', i.name)
    from input i
    on conflict (tenant_id, lower(name)) do update
      set default_lead_time_days = excluded.default_lead_time_days,
          min_order_value = excluded.min_order_value,
          status = excluded.status,
          updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;

revoke execute on function public.import_suppliers(jsonb) from public;
grant execute on function public.import_suppliers(jsonb) to authenticated;
