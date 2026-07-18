-- W3-4 review hardening: make the primary-location handoff deterministic.
--
-- The original single UPDATE assigned false to the old primary and true to the
-- target. PostgreSQL's non-deferrable partial unique index can check each row as
-- it is visited; if the target is visited first, the statement transiently sees
-- two primary rows and fails. Two statements remain atomic inside the RPC while
-- ensuring the unique slot is released before the target claims it.

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
  set is_primary = false
  where tenant_id = p_tenant and is_primary and id <> p_location;

  update public.locations
  set is_primary = true
  where tenant_id = p_tenant and id = p_location and not is_primary;
end;
$$;

revoke all on function public.set_primary_location(uuid, uuid) from public;
grant execute on function public.set_primary_location(uuid, uuid) to authenticated;

comment on function public.set_primary_location(uuid, uuid) is
  'Atomically moves the one primary marker by clearing the old unique-index slot before setting the target.';
