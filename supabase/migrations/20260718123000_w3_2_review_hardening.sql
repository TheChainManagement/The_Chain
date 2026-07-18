-- The Chain - W3-2 review hardening.
-- Records the membership-gated active-company switch in the destination
-- tenant's audit trail. Claim refresh remains the server action's responsibility.

create or replace function public.switch_active_tenant(p_tenant uuid)
returns table (out_tenant_id uuid, out_role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role public.member_role;
  v_previous uuid;
begin
  if v_user is null then raise exception 'switch_auth_required'; end if;

  select role into v_role
  from public.tenant_members
  where tenant_id = p_tenant and user_id = v_user;
  if not found then raise exception 'tenant_membership_required'; end if;

  select active_tenant_id into v_previous
  from public.profiles
  where user_id = v_user
  for update;

  insert into public.profiles (user_id, active_tenant_id)
  values (v_user, p_tenant)
  on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;

  if v_previous is distinct from p_tenant then
    insert into public.audit_log (
      tenant_id, actor_user_id, request_id, entity_type, entity_id, action, before, after
    ) values (
      p_tenant,
      v_user,
      nullif(current_setting('request.id', true), ''),
      'tenant_context',
      p_tenant,
      'tenant_context.switch',
      null,
      jsonb_build_object('active_tenant_id', p_tenant, 'role', v_role)
    );
  end if;

  return query select p_tenant, v_role;
end;
$$;

-- Supabase's default function privileges include direct anon/authenticated/
-- service_role ACLs. Revoke every direct grant before adding only the intended
-- caller; revoking PUBLIC alone is not sufficient.
revoke all on function public.switch_active_tenant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.my_tenant_memberships()
  from public, anon, authenticated, service_role;
grant execute on function public.switch_active_tenant(uuid) to authenticated;
grant execute on function public.my_tenant_memberships() to authenticated;

-- Apply the same direct-ACL hardening to the W3-0/W3-1 callable spine.
revoke all on function public.change_tenant_member_role(uuid, uuid, public.member_role)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_tenant_member(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.change_tenant_member_role(uuid, uuid, public.member_role)
  to authenticated;
grant execute on function public.remove_tenant_member(uuid, uuid) to authenticated;

revoke all on function public.create_tenant_access_provision(
  uuid, citext, uuid, public.member_role, boolean, boolean, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.revoke_tenant_access_provision(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.rotate_tenant_access_provision(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.find_auth_user_id_by_email(citext)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_provisional_password_replaced(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.my_pending_tenant_access()
  from public, anon, authenticated, service_role;
revoke all on function public.activate_tenant_access(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_tenant_access_provision(
  uuid, citext, uuid, public.member_role, boolean, boolean, timestamptz, uuid
) to authenticated;
grant execute on function public.revoke_tenant_access_provision(uuid, uuid) to authenticated;
grant execute on function public.rotate_tenant_access_provision(uuid, uuid, timestamptz)
  to authenticated;
grant execute on function public.find_auth_user_id_by_email(citext) to service_role;
grant execute on function public.mark_provisional_password_replaced(uuid, uuid) to service_role;
grant execute on function public.my_pending_tenant_access() to authenticated;
grant execute on function public.activate_tenant_access(uuid) to authenticated;
