-- ============================================================
-- The Chain — Phase 5J foundation hardening
-- Addresses the Codex full-weight Phase 5 review (2026-05-31,
-- _reviews/2026-05-31_foundation.md). Closes cross-tenant escalation holes.
-- ============================================================

-- ---------------------------------------------------------------------------
-- BLOCKER 1 + 2: tenant-claim integrity.
-- The custom access token hook must NOT mint a tenant_id claim from
-- profiles.active_tenant_id unless a real tenant_members row exists. Otherwise a
-- user could set their own active_tenant_id to any tenant UUID (or a removed
-- member could re-login) and pass every `tenant_id = jwt_tenant_id()` policy.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  active_tenant uuid;
  user_role member_role;
  gen int;
  claims jsonb;
begin
  uid := (event->>'user_id')::uuid;
  claims := coalesce(event->'claims', '{}'::jsonb);

  select active_tenant_id into active_tenant from public.profiles where user_id = uid;

  if active_tenant is not null then
    select tm.role into user_role
      from public.tenant_members tm
      where tm.tenant_id = active_tenant and tm.user_id = uid;

    -- ONLY emit tenant claims when membership is real. A spoofed or stale
    -- active_tenant_id (no membership row) yields zero tenant claims, so every
    -- tenant-scoped RLS predicate denies access.
    if user_role is not null then
      select t.token_generation into gen from public.tenants t where t.id = active_tenant;
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(active_tenant::text));
      claims := jsonb_set(claims, '{role}', to_jsonb(user_role::text));
      if gen is not null then
        claims := jsonb_set(claims, '{token_generation}', to_jsonb(gen));
      end if;
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

-- profiles.active_tenant_id may only point at a tenant the user belongs to.
-- (bootstrap_tenant is SECURITY DEFINER and bypasses these, so signup still
-- writes the profile alongside the membership it creates in the same tx.)
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      active_tenant_id is null
      or exists (
        select 1 from tenant_members tm
        where tm.tenant_id = active_tenant_id and tm.user_id = auth.uid()
      )
    )
  );

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert
  with check (
    user_id = auth.uid()
    and (
      active_tenant_id is null
      or exists (
        select 1 from tenant_members tm
        where tm.tenant_id = active_tenant_id and tm.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- HIGH 3: tenant-scoped composite foreign keys.
-- Child rows referenced parent IDs globally, so a tenant could attach a row to
-- another tenant's parent by guessing its UUID. Re-key to (tenant_id, parent_id).
-- ---------------------------------------------------------------------------
alter table purchase_orders add constraint purchase_orders_tenant_id_id_key unique (tenant_id, id);
alter table forecasts add constraint forecasts_tenant_id_id_key unique (tenant_id, id);
alter table cycle_count_sessions add constraint cycle_count_sessions_tenant_id_id_key unique (tenant_id, id);

alter table purchase_order_lines drop constraint purchase_order_lines_po_id_fkey;
alter table purchase_order_lines add constraint purchase_order_lines_tenant_po_fkey
  foreign key (tenant_id, po_id) references purchase_orders(tenant_id, id) on delete cascade;

alter table supplier_performance drop constraint supplier_performance_po_id_fkey;
alter table supplier_performance add constraint supplier_performance_tenant_po_fkey
  foreign key (tenant_id, po_id) references purchase_orders(tenant_id, id) on delete cascade;

alter table forecast_points drop constraint forecast_points_forecast_id_fkey;
alter table forecast_points add constraint forecast_points_tenant_forecast_fkey
  foreign key (tenant_id, forecast_id) references forecasts(tenant_id, id) on delete cascade;

alter table forecast_evaluations drop constraint forecast_evaluations_forecast_id_fkey;
alter table forecast_evaluations add constraint forecast_evaluations_tenant_forecast_fkey
  foreign key (tenant_id, forecast_id) references forecasts(tenant_id, id) on delete cascade;

alter table cycle_count_lines drop constraint cycle_count_lines_session_id_fkey;
alter table cycle_count_lines add constraint cycle_count_lines_tenant_session_fkey
  foreign key (tenant_id, session_id) references cycle_count_sessions(tenant_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- HIGH 3 (round 2, from the re-review): the remaining global parent FKs.
--   * sync tables → source_connections / sync_runs: system-only mutate, but
--     re-key to composite for integrity (they use ON DELETE CASCADE, which is
--     compatible with a composite tenant FK).
--   * purchase_orders.recommendation_id → reorder_recommendations: this one IS
--     user-mutable, so it is the real attack surface. It uses ON DELETE SET NULL
--     (a composite FK can't null the NOT-NULL tenant_id), so we enforce
--     same-tenant with a security-definer trigger instead.
--   * inventory_policy.based_on_forecast_id → forecasts: ACCEPTED as-is.
--     inventory_policy is system-only mutate (no user INSERT/UPDATE policy); the
--     service role writes same-tenant references. No user attack surface. Uses
--     ON DELETE SET NULL which a composite FK would break.
-- ---------------------------------------------------------------------------
alter table source_connections add constraint source_connections_tenant_id_id_key unique (tenant_id, id);
alter table sync_runs add constraint sync_runs_tenant_id_id_key unique (tenant_id, id);

alter table sync_conflicts drop constraint sync_conflicts_source_connection_id_fkey;
alter table sync_conflicts add constraint sync_conflicts_tenant_conn_fkey
  foreign key (tenant_id, source_connection_id) references source_connections(tenant_id, id) on delete cascade;

alter table sync_runs drop constraint sync_runs_connection_id_fkey;
alter table sync_runs add constraint sync_runs_tenant_conn_fkey
  foreign key (tenant_id, connection_id) references source_connections(tenant_id, id) on delete cascade;

alter table sync_failures drop constraint sync_failures_sync_run_id_fkey;
alter table sync_failures add constraint sync_failures_tenant_run_fkey
  foreign key (tenant_id, sync_run_id) references sync_runs(tenant_id, id) on delete cascade;

-- Same-tenant enforcement for the user-mutable PO -> recommendation reference.
create or replace function public.enforce_po_recommendation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recommendation_id is not null
     and not exists (
       select 1 from public.reorder_recommendations r
       where r.id = new.recommendation_id and r.tenant_id = new.tenant_id
     ) then
    raise exception 'recommendation_id % is not in tenant %', new.recommendation_id, new.tenant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger purchase_orders_recommendation_tenant
  before insert or update on public.purchase_orders
  for each row execute function public.enforce_po_recommendation_tenant();

-- ---------------------------------------------------------------------------
-- BLOCKER (found while hardening): partition children are a side door.
-- RLS policies on a partitioned PARENT are enforced for parent-routed queries,
-- but a direct query against a partition child (stock_movements_2026,
-- audit_log_2026, ...) enforces only the CHILD's RLS — which is none. The
-- `authenticated` role could read every tenant's ledger via the children.
--
-- Fix: revoke direct table privileges on the partition children from anon +
-- authenticated. Parent-routed queries are unaffected (Postgres checks
-- privileges against the partitioned parent, not its partitions). Future
-- partitions created by coldArchiveWorkflow must apply the same revoke.
-- ---------------------------------------------------------------------------
revoke all on
  public.stock_movements_2026, public.stock_movements_2027, public.stock_movements_default,
  public.audit_log_2026, public.audit_log_2027, public.audit_log_default
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- HIGH 4: audit completeness.
-- SYSTEM_DESIGN requires every state change to write audit. Re-attach the single
-- capture_audit dispatcher to EVERY table carrying a tenant_id (except audit_log
-- itself, to avoid recursion). This supersedes the static 13-table list from 5F
-- and auto-covers tables added later. Tables without tenant_id (profiles,
-- tenants) cannot use this dispatcher and are out of scope here.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and c.relname <> 'audit_log'
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || r.relname, r.relname);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.capture_audit()',
      'audit_' || r.relname, r.relname
    );
  end loop;
end;
$$;
