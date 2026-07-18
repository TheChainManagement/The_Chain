-- The Chain — W3-3 per-location member assignments.
--
-- JWT claims select the active tenant and role. Location authorization is
-- deliberately read from current database membership on every policy check so
-- a stale token cannot preserve access after an assignment is removed.

alter table public.tenant_members
  add column all_locations boolean not null default true;

create table public.tenant_member_locations (
  tenant_id uuid not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, location_id),
  foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, location_id)
    references public.locations(tenant_id, id) on delete cascade
);

create index tenant_member_locations_location_idx
  on public.tenant_member_locations (tenant_id, location_id, user_id);

alter table public.tenant_member_locations enable row level security;

-- Internal primitive used by RLS and privileged server-side posting paths.
-- It checks the membership table, never JWT assignment data.
create or replace function public.member_can_access_location(
  p_tenant uuid,
  p_user uuid,
  p_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant
      and m.user_id = p_user
      and (
        m.role in ('owner', 'manager')
        or m.all_locations
        or exists (
          select 1
          from public.tenant_member_locations ml
          where ml.tenant_id = m.tenant_id
            and ml.user_id = m.user_id
            and ml.location_id = p_location
        )
      )
  );
$$;

create or replace function public.can_access_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_location is not null
    and public.member_can_access_location(
      public.jwt_tenant_id(), auth.uid(), p_location
    );
$$;

create or replace function public.can_access_all_locations()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = public.jwt_tenant_id()
      and m.user_id = auth.uid()
      and (m.role in ('owner', 'manager') or m.all_locations)
  );
$$;

comment on function public.can_access_location(uuid) is
  'W3-3 current-database location gate for the authenticated user and JWT-selected tenant.';

revoke all on function public.member_can_access_location(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_access_location(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_access_all_locations()
  from public, anon, authenticated, service_role;
grant execute on function public.member_can_access_location(uuid, uuid, uuid) to service_role;
grant execute on function public.can_access_location(uuid) to authenticated;
grant execute on function public.can_access_all_locations() to authenticated;

-- Owners and managers remain company-wide. A lower role may be switched to a
-- restricted set only after at least one active assignment exists.
create or replace function public.enforce_member_location_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role in ('owner', 'manager') and not new.all_locations then
    raise exception 'privileged_member_requires_all_locations';
  end if;
  if not new.all_locations and not exists (
    select 1
    from public.tenant_member_locations ml
    join public.locations l
      on l.tenant_id = ml.tenant_id and l.id = ml.location_id
    where ml.tenant_id = new.tenant_id
      and ml.user_id = new.user_id
      and l.active
  ) then
    raise exception 'location_assignment_required';
  end if;
  return new;
end;
$$;

create trigger tenant_members_location_contract
before insert or update of role, all_locations on public.tenant_members
for each row execute function public.enforce_member_location_contract();

create or replace function public.enforce_member_location_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  select role into v_role
  from public.tenant_members
  where tenant_id = new.tenant_id and user_id = new.user_id;
  if not found then raise exception 'tenant_member_not_found'; end if;
  if v_role in ('owner', 'manager') then
    raise exception 'privileged_member_requires_all_locations';
  end if;
  if not exists (
    select 1 from public.locations
    where tenant_id = new.tenant_id and id = new.location_id and active
  ) then
    raise exception 'active_location_not_found';
  end if;
  return new;
end;
$$;

create trigger tenant_member_locations_contract
before insert or update on public.tenant_member_locations
for each row execute function public.enforce_member_location_assignment();

create or replace function public.enforce_final_location_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tenant_members m
    where m.tenant_id = old.tenant_id
      and m.user_id = old.user_id
      and not m.all_locations
  ) and not exists (
    select 1 from public.tenant_member_locations ml
    join public.locations l
      on l.tenant_id = ml.tenant_id and l.id = ml.location_id
    where ml.tenant_id = old.tenant_id
      and ml.user_id = old.user_id
      and l.active
  ) then
    raise exception 'final_location_assignment_required';
  end if;
  return null;
end;
$$;

create constraint trigger tenant_member_locations_keep_one
after delete or update on public.tenant_member_locations
deferrable initially deferred
for each row execute function public.enforce_final_location_assignment();

-- Archiving a location must not silently strand a restricted member. The
-- member can be broadened or assigned another active site in the same
-- transaction before the archive attempt.
create or replace function public.enforce_location_member_coverage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' or (old.active and not new.active)) and exists (
    select 1
    from public.tenant_member_locations ml
    join public.tenant_members m
      on m.tenant_id = ml.tenant_id and m.user_id = ml.user_id
    where ml.tenant_id = old.tenant_id
      and ml.location_id = old.id
      and not m.all_locations
      and not exists (
        select 1
        from public.tenant_member_locations other_ml
        join public.locations other_l
          on other_l.tenant_id = other_ml.tenant_id
          and other_l.id = other_ml.location_id
        where other_ml.tenant_id = ml.tenant_id
          and other_ml.user_id = ml.user_id
          and other_ml.location_id <> old.id
          and other_l.active
      )
  ) then
    raise exception 'location_has_final_member_assignment';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger locations_member_coverage
before update of active or delete on public.locations
for each row execute function public.enforce_location_member_coverage();

create policy tenant_member_locations_select on public.tenant_member_locations
for select using (
  tenant_id = public.jwt_tenant_id()
  and (
    user_id = auth.uid()
    or exists (
      select 1 from public.tenant_members actor
      where actor.tenant_id = tenant_member_locations.tenant_id
        and actor.user_id = auth.uid()
        and actor.role in ('owner', 'manager')
    )
  )
);

-- No direct assignment writes. The guarded set operation is the only member door.
create or replace function public.set_tenant_member_location_access(
  p_tenant uuid,
  p_member uuid,
  p_all_locations boolean,
  p_location_ids uuid[] default array[]::uuid[]
)
returns table (out_user_id uuid, out_all_locations boolean, out_location_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_target_role public.member_role;
  v_requested_count integer;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'membership_management_forbidden';
  end if;

  perform 1 from public.tenants where id = p_tenant for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select role into v_actor_role
  from public.tenant_members
  where tenant_id = p_tenant and user_id = v_actor
  for update;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'membership_management_forbidden';
  end if;

  select role into v_target_role
  from public.tenant_members
  where tenant_id = p_tenant and user_id = p_member
  for update;
  if not found then raise exception 'tenant_member_not_found'; end if;
  if p_member = v_actor then raise exception 'self_location_change_forbidden'; end if;
  if v_actor_role = 'manager' and v_target_role in ('owner', 'manager') then
    raise exception 'privileged_role_management_forbidden';
  end if;

  if v_target_role in ('owner', 'manager') then
    update public.tenant_members
      set all_locations = true
      where tenant_id = p_tenant and user_id = p_member;
    delete from public.tenant_member_locations
      where tenant_id = p_tenant and user_id = p_member;
    return query select p_member, true, 0;
    return;
  end if;

  if p_all_locations then
    update public.tenant_members
      set all_locations = true
      where tenant_id = p_tenant and user_id = p_member;
    delete from public.tenant_member_locations
      where tenant_id = p_tenant and user_id = p_member;
    return query select p_member, true, 0;
    return;
  end if;

  select count(distinct requested.location_id)::integer into v_requested_count
  from unnest(coalesce(p_location_ids, array[]::uuid[])) requested(location_id)
  join public.locations l
    on l.tenant_id = p_tenant and l.id = requested.location_id and l.active;
  if v_requested_count < 1 then raise exception 'location_assignment_required'; end if;
  if v_requested_count <> (
    select count(distinct requested.location_id)::integer
    from unnest(coalesce(p_location_ids, array[]::uuid[])) requested(location_id)
  ) then
    raise exception 'active_location_not_found';
  end if;

  insert into public.tenant_member_locations (tenant_id, user_id, location_id)
  select p_tenant, p_member, requested.location_id
  from unnest(p_location_ids) requested(location_id)
  on conflict do nothing;

  delete from public.tenant_member_locations ml
  where ml.tenant_id = p_tenant
    and ml.user_id = p_member
    and not (ml.location_id = any(p_location_ids));

  update public.tenant_members
    set all_locations = false
    where tenant_id = p_tenant and user_id = p_member;

  return query select p_member, false, v_requested_count;
end;
$$;

revoke all on function public.set_tenant_member_location_access(uuid, uuid, boolean, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.set_tenant_member_location_access(uuid, uuid, boolean, uuid[]) to authenticated;

create trigger audit_tenant_member_locations
after insert or update or delete on public.tenant_member_locations
for each row execute function public.capture_audit();

-- A role promotion and its location broadening are one guarded transaction.
create or replace function public.change_tenant_member_role(
  p_tenant uuid,
  p_member uuid,
  p_role public.member_role
)
returns table (out_user_id uuid, out_role public.member_role, out_changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_target_role public.member_role;
  v_owner_count int;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'membership_management_forbidden';
  end if;
  perform 1 from public.tenants where id = p_tenant for update;
  if not found then raise exception 'tenant_not_found'; end if;
  select role into v_actor_role from public.tenant_members
    where tenant_id = p_tenant and user_id = v_actor for update;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'membership_management_forbidden';
  end if;
  select role into v_target_role from public.tenant_members
    where tenant_id = p_tenant and user_id = p_member for update;
  if not found then raise exception 'tenant_member_not_found'; end if;
  if p_member = v_actor then raise exception 'self_role_change_forbidden'; end if;
  if v_actor_role = 'manager'
     and (v_target_role in ('owner', 'manager') or p_role in ('owner', 'manager')) then
    raise exception 'privileged_role_management_forbidden';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*)::int into v_owner_count from public.tenant_members
      where tenant_id = p_tenant and role = 'owner';
    if v_owner_count <= 1 then raise exception 'last_owner_required'; end if;
  end if;
  if v_target_role = p_role then
    return query select p_member, p_role, false;
    return;
  end if;
  if p_role in ('owner', 'manager') then
    update public.tenant_members set all_locations = true
      where tenant_id = p_tenant and user_id = p_member;
    delete from public.tenant_member_locations
      where tenant_id = p_tenant and user_id = p_member;
  end if;
  update public.tenant_members set role = p_role
    where tenant_id = p_tenant and user_id = p_member;
  return query select p_member, p_role, true;
end;
$$;

revoke all on function public.change_tenant_member_role(uuid, uuid, public.member_role)
  from public, anon, authenticated, service_role;
grant execute on function public.change_tenant_member_role(uuid, uuid, public.member_role)
  to authenticated;

revoke all on function public.enforce_member_location_contract()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_member_location_assignment()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_final_location_assignment()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_location_member_coverage()
  from public, anon, authenticated, service_role;

-- Location headers and operational rows are filtered by current assignment.
drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(id)
);
drop policy if exists locations_insert on public.locations;
create policy locations_insert on public.locations for insert with check (
  tenant_id = public.jwt_tenant_id()
  and exists (select 1 from public.tenant_members m where m.tenant_id = locations.tenant_id
    and m.user_id = auth.uid() and m.role in ('owner', 'manager'))
);
drop policy if exists locations_update on public.locations;
create policy locations_update on public.locations for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(id)
  and exists (select 1 from public.tenant_members m where m.tenant_id = locations.tenant_id
    and m.user_id = auth.uid() and m.role in ('owner', 'manager'))
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(id)
  and exists (select 1 from public.tenant_members m where m.tenant_id = locations.tenant_id
    and m.user_id = auth.uid() and m.role in ('owner', 'manager'))
);
drop policy if exists locations_delete on public.locations;
create policy locations_delete on public.locations for delete using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(id)
  and exists (select 1 from public.tenant_members m where m.tenant_id = locations.tenant_id
    and m.user_id = auth.uid() and m.role = 'owner')
);

drop policy if exists product_classifications_select on public.product_classifications;
create policy product_classifications_select on public.product_classifications for select using (
  tenant_id = public.jwt_tenant_id()
  and (
    (location_id is null and public.can_access_all_locations())
    or public.can_access_location(location_id)
  )
);

drop policy if exists inventory_levels_select on public.inventory_levels;
create policy inventory_levels_select on public.inventory_levels for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists inventory_levels_insert on public.inventory_levels;
drop policy if exists inventory_levels_update on public.inventory_levels;

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists stock_movements_insert on public.stock_movements;

drop policy if exists forecasts_select on public.forecasts;
create policy forecasts_select on public.forecasts for select using (
  tenant_id = public.jwt_tenant_id()
  and (
    (location_id is null and public.can_access_all_locations())
    or public.can_access_location(location_id)
  )
);
drop policy if exists forecast_points_select on public.forecast_points;
create policy forecast_points_select on public.forecast_points for select using (
  tenant_id = public.jwt_tenant_id()
  and exists (
    select 1 from public.forecasts f
    where f.id = forecast_points.forecast_id
      and f.tenant_id = forecast_points.tenant_id
      and (
        (f.location_id is null and public.can_access_all_locations())
        or public.can_access_location(f.location_id)
      )
  )
);
drop policy if exists forecast_evaluations_select on public.forecast_evaluations;
create policy forecast_evaluations_select on public.forecast_evaluations for select using (
  tenant_id = public.jwt_tenant_id()
  and exists (
    select 1 from public.forecasts f
    where f.id = forecast_evaluations.forecast_id
      and f.tenant_id = forecast_evaluations.tenant_id
      and (
        (f.location_id is null and public.can_access_all_locations())
        or public.can_access_location(f.location_id)
      )
  )
);
drop policy if exists inventory_policy_select on public.inventory_policy;
create policy inventory_policy_select on public.inventory_policy for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);

drop policy if exists reorder_recommendations_select on public.reorder_recommendations;
create policy reorder_recommendations_select on public.reorder_recommendations for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists reorder_recommendations_update on public.reorder_recommendations;
create policy reorder_recommendations_update on public.reorder_recommendations for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders for insert with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete on public.purchase_orders for delete using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.is_owner()
);

drop policy if exists purchase_order_lines_select on public.purchase_order_lines;
create policy purchase_order_lines_select on public.purchase_order_lines for select using (
  tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.purchase_orders po where po.id = purchase_order_lines.po_id
      and po.tenant_id = purchase_order_lines.tenant_id
      and public.can_access_location(po.location_id)
  )
);
drop policy if exists purchase_order_lines_insert on public.purchase_order_lines;
create policy purchase_order_lines_insert on public.purchase_order_lines for insert with check (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'planner')
  and exists (select 1 from public.purchase_orders po where po.id = purchase_order_lines.po_id
    and po.tenant_id = purchase_order_lines.tenant_id and public.can_access_location(po.location_id))
);
drop policy if exists purchase_order_lines_update on public.purchase_order_lines;
create policy purchase_order_lines_update on public.purchase_order_lines for update using (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'planner')
  and exists (select 1 from public.purchase_orders po where po.id = purchase_order_lines.po_id
    and po.tenant_id = purchase_order_lines.tenant_id and public.can_access_location(po.location_id))
) with check (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'planner')
  and exists (select 1 from public.purchase_orders po where po.id = purchase_order_lines.po_id
    and po.tenant_id = purchase_order_lines.tenant_id and public.can_access_location(po.location_id))
);
drop policy if exists purchase_order_lines_delete on public.purchase_order_lines;
create policy purchase_order_lines_delete on public.purchase_order_lines for delete using (
  tenant_id = public.jwt_tenant_id() and public.is_owner()
  and exists (select 1 from public.purchase_orders po where po.id = purchase_order_lines.po_id
    and po.tenant_id = purchase_order_lines.tenant_id and public.can_access_location(po.location_id))
);

drop policy if exists po_receipt_events_select on public.po_receipt_events;
create policy po_receipt_events_select on public.po_receipt_events for select using (
  tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.purchase_orders po where po.id = po_receipt_events.po_id
      and po.tenant_id = po_receipt_events.tenant_id
      and public.can_access_location(po.location_id)
  )
);
drop policy if exists supplier_performance_select on public.supplier_performance;
create policy supplier_performance_select on public.supplier_performance for select using (
  tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.purchase_orders po where po.id = supplier_performance.po_id
      and po.tenant_id = supplier_performance.tenant_id
      and public.can_access_location(po.location_id)
  )
);

drop policy if exists cycle_count_sessions_select on public.cycle_count_sessions;
create policy cycle_count_sessions_select on public.cycle_count_sessions for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists cycle_count_sessions_insert on public.cycle_count_sessions;
create policy cycle_count_sessions_insert on public.cycle_count_sessions for insert with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'warehouse')
);
drop policy if exists cycle_count_sessions_update on public.cycle_count_sessions;
create policy cycle_count_sessions_update on public.cycle_count_sessions for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'warehouse')
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'warehouse')
);
drop policy if exists cycle_count_sessions_delete on public.cycle_count_sessions;
create policy cycle_count_sessions_delete on public.cycle_count_sessions for delete using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.is_owner()
);

drop policy if exists cycle_count_lines_select on public.cycle_count_lines;
create policy cycle_count_lines_select on public.cycle_count_lines for select using (
  tenant_id = public.jwt_tenant_id() and exists (
    select 1 from public.cycle_count_sessions s where s.id = cycle_count_lines.session_id
      and s.tenant_id = cycle_count_lines.tenant_id
      and public.can_access_location(s.location_id)
  )
);
drop policy if exists cycle_count_lines_insert on public.cycle_count_lines;
create policy cycle_count_lines_insert on public.cycle_count_lines for insert with check (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'warehouse')
  and exists (select 1 from public.cycle_count_sessions s where s.id = cycle_count_lines.session_id
    and s.tenant_id = cycle_count_lines.tenant_id and public.can_access_location(s.location_id))
);
drop policy if exists cycle_count_lines_update on public.cycle_count_lines;
create policy cycle_count_lines_update on public.cycle_count_lines for update using (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'warehouse')
  and exists (select 1 from public.cycle_count_sessions s where s.id = cycle_count_lines.session_id
    and s.tenant_id = cycle_count_lines.tenant_id and public.can_access_location(s.location_id))
) with check (
  tenant_id = public.jwt_tenant_id() and public.has_role('owner', 'manager', 'warehouse')
  and exists (select 1 from public.cycle_count_sessions s where s.id = cycle_count_lines.session_id
    and s.tenant_id = cycle_count_lines.tenant_id and public.can_access_location(s.location_id))
);
drop policy if exists cycle_count_lines_delete on public.cycle_count_lines;
create policy cycle_count_lines_delete on public.cycle_count_lines for delete using (
  tenant_id = public.jwt_tenant_id() and public.is_owner()
  and exists (select 1 from public.cycle_count_sessions s where s.id = cycle_count_lines.session_id
    and s.tenant_id = cycle_count_lines.tenant_id and public.can_access_location(s.location_id))
);

-- Procurement descendants inherit the header location in their policy.
drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists rfqs_insert on public.rfqs;
create policy rfqs_insert on public.rfqs for insert with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists rfqs_update on public.rfqs;
create policy rfqs_update on public.rfqs for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists rfqs_delete on public.rfqs;
create policy rfqs_delete on public.rfqs for delete using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.is_owner()
);

drop policy if exists requisitions_select on public.requisitions;
create policy requisitions_select on public.requisitions for select using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
);
drop policy if exists requisitions_insert on public.requisitions;
create policy requisitions_insert on public.requisitions for insert with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists requisitions_update on public.requisitions;
create policy requisitions_update on public.requisitions for update using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
) with check (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.has_role('owner', 'manager', 'planner')
);
drop policy if exists requisitions_delete on public.requisitions;
create policy requisitions_delete on public.requisitions for delete using (
  tenant_id = public.jwt_tenant_id() and public.can_access_location(location_id)
  and public.is_owner()
);

do $$
declare
  t text;
  parent_table text;
  parent_key text;
  child_key text;
  child_tables text[][] := array[
    array['rfq_lines', 'rfqs', 'rfq_id', 'id'],
    array['rfq_vendors', 'rfqs', 'rfq_id', 'id'],
    array['rfq_vendor_quotes', 'rfqs', 'rfq_id', 'id'],
    array['requisition_lines', 'requisitions', 'requisition_id', 'id']
  ];
  item text[];
begin
  foreach item slice 1 in array child_tables loop
    t := item[1]; parent_table := item[2]; child_key := item[3]; parent_key := item[4];
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using '
      '(tenant_id = public.jwt_tenant_id() and exists '
      '(select 1 from public.%I h where h.%I = %I.%I and h.tenant_id = %I.tenant_id '
      'and public.can_access_location(h.location_id)))',
      t || '_select', t, parent_table, parent_key, t, child_key, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check '
      '(tenant_id = public.jwt_tenant_id() and public.has_role(''owner'',''manager'',''planner'') '
      'and exists (select 1 from public.%I h where h.%I = %I.%I '
      'and h.tenant_id = %I.tenant_id and public.can_access_location(h.location_id)))',
      t || '_insert', t, parent_table, parent_key, t, child_key, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using '
      '(tenant_id = public.jwt_tenant_id() and public.has_role(''owner'',''manager'',''planner'') '
      'and exists (select 1 from public.%I h where h.%I = %I.%I '
      'and h.tenant_id = %I.tenant_id and public.can_access_location(h.location_id))) '
      'with check (tenant_id = public.jwt_tenant_id() and public.has_role(''owner'',''manager'',''planner'') '
      'and exists (select 1 from public.%I h where h.%I = %I.%I '
      'and h.tenant_id = %I.tenant_id and public.can_access_location(h.location_id)))',
      t || '_update', t,
      parent_table, parent_key, t, child_key, t,
      parent_table, parent_key, t, child_key, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using '
      '(tenant_id = public.jwt_tenant_id() and public.is_owner() '
      'and exists (select 1 from public.%I h where h.%I = %I.%I '
      'and h.tenant_id = %I.tenant_id and public.can_access_location(h.location_id)))',
      t || '_delete', t, parent_table, parent_key, t, child_key, t
    );
  end loop;
end;
$$;

drop policy if exists stock_transfer_events_select on public.stock_transfer_events;
create policy stock_transfer_events_select on public.stock_transfer_events for select using (
  tenant_id = public.jwt_tenant_id()
  and public.can_access_location(source_location_id)
  and public.can_access_location(destination_location_id)
);

comment on table public.tenant_member_locations is
  'W3-3 restricted-member location assignments. Empty rows mean all locations only when tenant_members.all_locations is true.';
