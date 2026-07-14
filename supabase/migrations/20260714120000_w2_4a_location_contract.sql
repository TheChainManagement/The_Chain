-- W2-4a: activate locations as an operator-managed lifecycle boundary.

alter table public.locations
  add column if not exists is_primary boolean not null default false;

-- Preserve the legacy "oldest location is primary" behavior exactly once.
with ranked as (
  select tenant_id, id,
         row_number() over (partition by tenant_id order by created_at, id) as rn
  from public.locations
  where active
)
update public.locations l
set is_primary = true
from ranked r
where l.tenant_id = r.tenant_id and l.id = r.id and r.rn = 1
  and not exists (
    select 1 from public.locations p
    where p.tenant_id = l.tenant_id and p.is_primary
  );

create unique index if not exists locations_one_primary
  on public.locations (tenant_id)
  where is_primary;

create unique index if not exists locations_active_name_unique
  on public.locations (tenant_id, lower(btrim(name)))
  where active;

alter table public.locations
  add constraint locations_primary_active_check
  check (not is_primary or active);

create or replace function public.guard_location_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Location name is required.' using errcode = '22023';
  end if;

  if old.active and not new.active then
    if old.is_primary then
      raise exception 'Choose another primary location before archiving this one.'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.inventory_levels il
      where il.tenant_id = old.tenant_id and il.location_id = old.id
        and (il.on_hand <> 0 or il.on_hold <> 0 or il.allocated <> 0 or il.in_transit <> 0)
    ) then
      raise exception 'Location has a non-zero inventory position.' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.purchase_orders po
      where po.tenant_id = old.tenant_id and po.location_id = old.id
        and po.status not in ('received', 'closed', 'canceled')
    ) then
      raise exception 'Location has an open purchase order.' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.rfqs r
      where r.tenant_id = old.tenant_id and r.location_id = old.id
        and r.status not in ('closed', 'canceled')
    ) or exists (
      select 1 from public.requisitions r
      where r.tenant_id = old.tenant_id and r.location_id = old.id
        and r.status not in ('converted', 'canceled')
    ) then
      raise exception 'Location has an open procurement document.' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.cycle_count_sessions c
      where c.tenant_id = old.tenant_id and c.location_id = old.id
        and c.status in ('open', 'in_progress')
    ) then
      raise exception 'Location has an open cycle count.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.default_first_location_primary()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Location name is required.' using errcode = '22023';
  end if;
  if new.active and not new.is_primary and not exists (
    select 1 from public.locations
    where tenant_id = new.tenant_id and is_primary
  ) then
    new.is_primary := true;
  end if;
  return new;
end;
$$;

create trigger locations_default_primary
before insert on public.locations
for each row execute function public.default_first_location_primary();

create trigger locations_lifecycle_guard
before update of name, active, is_primary on public.locations
for each row execute function public.guard_location_lifecycle();

create or replace function public.set_primary_location(
  p_tenant uuid,
  p_location uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_tenant is distinct from public.jwt_tenant_id()
     or not public.has_role('owner', 'manager') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  perform 1 from public.locations
  where tenant_id = p_tenant
  order by id
  for update;

  if not exists (
    select 1 from public.locations
    where tenant_id = p_tenant and id = p_location and active
  ) then
    raise exception 'Active location not found.' using errcode = 'P0002';
  end if;

  update public.locations
  set is_primary = (id = p_location)
  where tenant_id = p_tenant and (is_primary or id = p_location);
end;
$$;

revoke all on function public.set_primary_location(uuid, uuid) from public;
grant execute on function public.set_primary_location(uuid, uuid) to authenticated;

comment on function public.set_primary_location(uuid, uuid) is
  'W2-4a: atomically moves the one primary marker within the caller tenant.';
