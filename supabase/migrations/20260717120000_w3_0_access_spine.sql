-- The Chain - W3-0 access-spine hardening.
--
-- Role rows existed from Wave 1, but raw owner/manager writes could bypass a
-- safe hierarchy. From this migration forward authenticated app callers mutate
-- membership only through guarded functions. Signup/service maintenance paths
-- remain available to their existing privileged callers.

drop policy if exists tenant_members_insert on public.tenant_members;
drop policy if exists tenant_members_update on public.tenant_members;
drop policy if exists tenant_members_delete on public.tenant_members;

-- Defense in depth for any future authenticated mutation path. Maintenance
-- operations without tenant JWT claims retain the established support path.
create or replace function public.enforce_tenant_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner_count int;
begin
  if public.jwt_tenant_id() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*)::int into v_owner_count
    from public.tenant_members
    where tenant_id = old.tenant_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'last_owner_required';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger tenant_members_last_owner
before update of role or delete on public.tenant_members
for each row execute function public.enforce_tenant_last_owner();

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

  -- One tenant lock serializes owner-count decisions, so two concurrent
  -- demotions/removals cannot both observe a safe pre-change owner count.
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
  if p_member = v_actor then raise exception 'self_role_change_forbidden'; end if;

  if v_actor_role = 'manager'
     and (v_target_role in ('owner', 'manager') or p_role in ('owner', 'manager')) then
    raise exception 'privileged_role_management_forbidden';
  end if;

  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*)::int into v_owner_count
    from public.tenant_members
    where tenant_id = p_tenant and role = 'owner';
    if v_owner_count <= 1 then raise exception 'last_owner_required'; end if;
  end if;

  if v_target_role = p_role then
    return query select p_member, p_role, false;
    return;
  end if;

  update public.tenant_members
  set role = p_role
  where tenant_id = p_tenant and user_id = p_member;

  return query select p_member, p_role, true;
end;
$$;

comment on function public.change_tenant_member_role(uuid, uuid, public.member_role) is
  'W3-0 guarded role change. Owners manage other members; managers manage lower roles only. Self-change and final-owner removal are forbidden.';

create or replace function public.remove_tenant_member(
  p_tenant uuid,
  p_member uuid
)
returns table (out_user_id uuid, out_removed boolean)
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
  if not found then
    return query select p_member, false;
    return;
  end if;
  if p_member = v_actor then raise exception 'self_removal_forbidden'; end if;

  if v_actor_role = 'manager' and v_target_role in ('owner', 'manager') then
    raise exception 'privileged_role_management_forbidden';
  end if;

  if v_target_role = 'owner' then
    select count(*)::int into v_owner_count
    from public.tenant_members
    where tenant_id = p_tenant and role = 'owner';
    if v_owner_count <= 1 then raise exception 'last_owner_required'; end if;
  end if;

  update public.profiles
  set active_tenant_id = null
  where user_id = p_member and active_tenant_id = p_tenant;

  delete from public.tenant_members
  where tenant_id = p_tenant and user_id = p_member;

  return query select p_member, true;
end;
$$;

comment on function public.remove_tenant_member(uuid, uuid) is
  'W3-0 guarded member removal. Owners manage other members; managers remove lower roles only. Active tenant state is cleared atomically.';

revoke all on function public.change_tenant_member_role(uuid, uuid, public.member_role) from public;
revoke all on function public.remove_tenant_member(uuid, uuid) from public;
grant execute on function public.change_tenant_member_role(uuid, uuid, public.member_role) to authenticated;
grant execute on function public.remove_tenant_member(uuid, uuid) to authenticated;
