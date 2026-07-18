-- The Chain - W3-1 owner-created provisional accounts.
--
-- A provisional Auth user has no tenant_members row and therefore receives no
-- tenant claims. The temporary password is generated and shown by the server
-- once; it is never stored here. Membership is created only after the password
-- replacement has been marked through the service-role-only seam.

create type public.tenant_access_status as enum ('pending', 'activated', 'revoked', 'expired');

create table public.tenant_access_provisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  proposed_role public.member_role not null,
  department_id uuid,
  status public.tenant_access_status not null default 'pending',
  requires_password_change boolean not null,
  created_auth_user boolean not null,
  credential_expires_at timestamptz,
  password_replaced_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  revoked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, department_id)
    references public.departments(tenant_id, id) on delete set null,
  constraint provisional_password_contract check (
    (requires_password_change and created_auth_user and credential_expires_at is not null)
    or
    (not requires_password_change and not created_auth_user and credential_expires_at is null)
  ),
  constraint provisional_activation_contract check (
    status <> 'activated' or activated_at is not null
  ),
  constraint provisional_revocation_contract check (
    status <> 'revoked' or revoked_at is not null
  )
);

create unique index tenant_access_one_pending_email
  on public.tenant_access_provisions (tenant_id, email)
  where status = 'pending';
create index tenant_access_pending_user
  on public.tenant_access_provisions (auth_user_id, status, created_at desc);
create index tenant_access_tenant_status
  on public.tenant_access_provisions (tenant_id, status, created_at desc);

create trigger tenant_access_provisions_updated_at
before update on public.tenant_access_provisions
for each row execute function public.set_updated_at();

create trigger audit_tenant_access_provisions
after insert or update or delete on public.tenant_access_provisions
for each row execute function public.capture_audit();

alter table public.tenant_access_provisions enable row level security;

create policy tenant_access_provisions_admin_select
on public.tenant_access_provisions for select to authenticated
using (
  tenant_id = public.jwt_tenant_id()
  and public.has_role('owner', 'manager')
);

-- Authenticated users never mutate provisioning rows directly. Guarded RPCs
-- below are the only application write path.

create or replace function public.create_tenant_access_provision(
  p_tenant uuid,
  p_email citext,
  p_auth_user uuid,
  p_role public.member_role,
  p_requires_password_change boolean,
  p_created_auth_user boolean,
  p_credential_expires_at timestamptz default null,
  p_department uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_id uuid;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'provision_management_forbidden';
  end if;

  perform 1 from public.tenants where id = p_tenant for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select role into v_actor_role
  from public.tenant_members
  where tenant_id = p_tenant and user_id = v_actor;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'provision_management_forbidden';
  end if;
  if v_actor_role = 'manager' and p_role in ('owner', 'manager') then
    raise exception 'privileged_role_management_forbidden';
  end if;
  if nullif(trim(p_email::text), '') is null then raise exception 'provision_email_required'; end if;

  if exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant and user_id = p_auth_user
  ) then
    raise exception 'tenant_member_already_exists';
  end if;

  if lower((select email from auth.users where id = p_auth_user))
     is distinct from lower(trim(p_email::text)) then
    raise exception 'provision_user_email_mismatch';
  end if;

  if p_requires_password_change is distinct from p_created_auth_user
     or (p_requires_password_change and p_credential_expires_at is null)
     or (not p_requires_password_change and p_credential_expires_at is not null) then
    raise exception 'invalid_provision_credential_contract';
  end if;

  insert into public.tenant_access_provisions (
    tenant_id, email, auth_user_id, proposed_role, department_id,
    requires_password_change, created_auth_user, credential_expires_at, created_by
  ) values (
    p_tenant, trim(p_email::text)::public.citext, p_auth_user, p_role, p_department,
    p_requires_password_change, p_created_auth_user, p_credential_expires_at, v_actor
  ) returning id into v_id;

  return v_id;
exception
  when unique_violation then raise exception 'provision_already_pending';
end;
$$;

create or replace function public.revoke_tenant_access_provision(
  p_tenant uuid,
  p_provision uuid
)
returns table (out_auth_user_id uuid, out_created_auth_user boolean, out_revoked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_provision public.tenant_access_provisions%rowtype;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'provision_management_forbidden';
  end if;
  perform 1 from public.tenants where id = p_tenant for update;
  select role into v_actor_role from public.tenant_members
    where tenant_id = p_tenant and user_id = v_actor;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'provision_management_forbidden';
  end if;

  select * into v_provision from public.tenant_access_provisions
    where id = p_provision and tenant_id = p_tenant for update;
  if not found then raise exception 'provision_not_found'; end if;
  if v_actor_role = 'manager' and v_provision.proposed_role in ('owner', 'manager') then
    raise exception 'privileged_role_management_forbidden';
  end if;
  if v_provision.status <> 'pending' then
    return query select v_provision.auth_user_id, v_provision.created_auth_user, false;
    return;
  end if;

  update public.tenant_access_provisions
    set status = 'revoked', revoked_at = now(), revoked_by = v_actor
    where id = p_provision;
  return query select v_provision.auth_user_id, v_provision.created_auth_user, true;
end;
$$;

create or replace function public.rotate_tenant_access_provision(
  p_tenant uuid,
  p_provision uuid,
  p_credential_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_provision public.tenant_access_provisions%rowtype;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'provision_management_forbidden';
  end if;
  perform 1 from public.tenants where id = p_tenant for update;
  select role into v_actor_role from public.tenant_members
    where tenant_id = p_tenant and user_id = v_actor;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'provision_management_forbidden';
  end if;
  select * into v_provision from public.tenant_access_provisions
    where id = p_provision and tenant_id = p_tenant for update;
  if not found then raise exception 'provision_not_found'; end if;
  if v_actor_role = 'manager' and v_provision.proposed_role in ('owner', 'manager') then
    raise exception 'privileged_role_management_forbidden';
  end if;
  if v_provision.status <> 'pending' or not v_provision.created_auth_user then
    raise exception 'provision_not_rotatable';
  end if;
  if p_credential_expires_at <= now() then raise exception 'credential_expiry_invalid'; end if;

  update public.tenant_access_provisions
  set credential_expires_at = p_credential_expires_at,
      password_replaced_at = null
  where id = p_provision;
  return v_provision.auth_user_id;
end;
$$;

-- The admin client uses this narrow function instead of paginating all Auth
-- users. Authenticated callers cannot use it to enumerate accounts.
create or replace function public.find_auth_user_id_by_email(p_email citext)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email::text)) limit 1
$$;

-- Called only after auth.updateUser(password) succeeds. This server-only mark
-- makes the activation RPC resistant to direct-call bypasses.
create or replace function public.mark_provisional_password_replaced(
  p_provision uuid,
  p_auth_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenant_access_provisions
  set password_replaced_at = now()
  where id = p_provision
    and auth_user_id = p_auth_user
    and status = 'pending'
    and requires_password_change
    and credential_expires_at > now();
  return found;
end;
$$;

create or replace function public.my_pending_tenant_access()
returns table (
  provision_id uuid,
  tenant_id uuid,
  tenant_name text,
  proposed_role public.member_role,
  requires_password_change boolean,
  credential_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.tenant_id, t.name, p.proposed_role,
         p.requires_password_change, p.credential_expires_at
  from public.tenant_access_provisions p
  join public.tenants t on t.id = p.tenant_id
  join auth.users u on u.id = auth.uid()
  where p.auth_user_id = auth.uid()
    and lower(p.email::text) = lower(u.email)
    and p.status = 'pending'
  order by p.created_at
$$;

create or replace function public.activate_tenant_access(p_provision uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_provision public.tenant_access_provisions%rowtype;
begin
  if v_user is null then raise exception 'activation_auth_required'; end if;
  select email into v_email from auth.users where id = v_user;

  select * into v_provision from public.tenant_access_provisions
  where id = p_provision and auth_user_id = v_user for update;
  if not found or lower(v_provision.email::text) is distinct from lower(v_email) then
    raise exception 'provision_not_found';
  end if;
  if v_provision.status = 'activated' then return v_provision.tenant_id; end if;
  if v_provision.status <> 'pending' then raise exception 'provision_not_active'; end if;
  if v_provision.requires_password_change
     and (v_provision.credential_expires_at <= now()
          or v_provision.password_replaced_at is null) then
    if v_provision.credential_expires_at <= now() then
      update public.tenant_access_provisions set status = 'expired' where id = p_provision;
      raise exception 'temporary_credential_expired';
    end if;
    raise exception 'password_replacement_required';
  end if;

  insert into public.profiles (user_id, active_tenant_id)
  values (v_user, v_provision.tenant_id)
  on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role, department_id)
  values (
    v_provision.tenant_id, v_user, v_provision.proposed_role, v_provision.department_id
  ) on conflict (tenant_id, user_id) do nothing;

  update public.tenant_access_provisions
  set status = 'activated', activated_at = now()
  where id = p_provision;

  return v_provision.tenant_id;
end;
$$;

revoke all on table public.tenant_access_provisions from public, anon, authenticated;
grant select on table public.tenant_access_provisions to authenticated;

revoke all on function public.create_tenant_access_provision(uuid, citext, uuid, public.member_role, boolean, boolean, timestamptz, uuid) from public;
revoke all on function public.revoke_tenant_access_provision(uuid, uuid) from public;
revoke all on function public.rotate_tenant_access_provision(uuid, uuid, timestamptz) from public;
revoke all on function public.find_auth_user_id_by_email(citext) from public;
revoke all on function public.mark_provisional_password_replaced(uuid, uuid) from public;
revoke all on function public.my_pending_tenant_access() from public;
revoke all on function public.activate_tenant_access(uuid) from public;

grant execute on function public.create_tenant_access_provision(uuid, citext, uuid, public.member_role, boolean, boolean, timestamptz, uuid) to authenticated;
grant execute on function public.revoke_tenant_access_provision(uuid, uuid) to authenticated;
grant execute on function public.rotate_tenant_access_provision(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.find_auth_user_id_by_email(citext) to service_role;
grant execute on function public.mark_provisional_password_replaced(uuid, uuid) to service_role;
grant execute on function public.my_pending_tenant_access() to authenticated;
grant execute on function public.activate_tenant_access(uuid) to authenticated;

comment on table public.tenant_access_provisions is
  'W3-1 tenant access staged before membership. Temporary passwords are never persisted.';
