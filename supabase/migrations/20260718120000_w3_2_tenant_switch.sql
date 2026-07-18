-- The Chain - W3-2 active-tenant switching.
--
-- A person can belong to more than one tenant (they activated a second company,
-- or own one and were added to another). The access-token hook mints tenant_id
-- and tenant_role from profiles.active_tenant_id, so switching context is: prove
-- membership in the target tenant, move active_tenant_id, then let the caller
-- refresh its session to re-mint claims. Membership is the gate; the target
-- tenant is never trusted from the client without it.

create or replace function public.switch_active_tenant(p_tenant uuid)
returns table (out_tenant_id uuid, out_role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role public.member_role;
begin
  if v_user is null then raise exception 'switch_auth_required'; end if;

  -- Only a real membership can become the active context. No membership → the
  -- switch is rejected and the active tenant is left untouched.
  select role into v_role
  from public.tenant_members
  where tenant_id = p_tenant and user_id = v_user;
  if not found then raise exception 'tenant_membership_required'; end if;

  insert into public.profiles (user_id, active_tenant_id)
  values (v_user, p_tenant)
  on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;

  return query select p_tenant, v_role;
end;
$$;

comment on function public.switch_active_tenant(uuid) is
  'W3-2 active-tenant switch. Requires a real membership in the target tenant; the caller refreshes its session afterward so the token hook re-mints claims.';

-- The switcher needs every tenant the caller belongs to, with names, across
-- tenant boundaries. tenants RLS is tenant-scoped, so a definer read is the
-- clean way to list them without loosening any policy.
create or replace function public.my_tenant_memberships()
returns table (tenant_id uuid, tenant_name text, role public.member_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id, t.name, m.role
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
  order by t.name
$$;

revoke all on function public.switch_active_tenant(uuid) from public;
revoke all on function public.my_tenant_memberships() from public;
grant execute on function public.switch_active_tenant(uuid) to authenticated;
grant execute on function public.my_tenant_memberships() to authenticated;
