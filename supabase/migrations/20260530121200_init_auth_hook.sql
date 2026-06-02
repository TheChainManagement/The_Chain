-- ============================================================
-- The Chain — Supabase Custom Access Token Hook
-- Source: SYSTEM_DESIGN.md §Auth and security flow
--
-- Adds tenant_id, role, token_generation custom claims to the access token JWT.
-- Registered in supabase/config.toml as [auth.hook.custom_access_token].
--
-- SUPERSEDED by 20260601130000_auth_role_claim_fix_5l.sql: the member role now
-- rides in a `tenant_role` claim, NOT the reserved top-level `role` (PostgREST
-- runs SET ROLE on `role`). This file is historical; 5L is the live shape.
-- ============================================================

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

  select active_tenant_id into active_tenant
    from public.profiles
    where user_id = uid;

  if active_tenant is not null then
    select tm.role into user_role
      from public.tenant_members tm
      where tm.tenant_id = active_tenant and tm.user_id = uid;

    select t.token_generation into gen
      from public.tenants t
      where t.id = active_tenant;

    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(active_tenant::text));
    if user_role is not null then
      claims := jsonb_set(claims, '{role}', to_jsonb(user_role::text));
    end if;
    if gen is not null then
      claims := jsonb_set(claims, '{token_generation}', to_jsonb(gen));
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
-- Auth admin needs to read the profile + member + tenant rows to populate claims.
grant usage on schema public to supabase_auth_admin;
grant select on table public.profiles, public.tenant_members, public.tenants
  to supabase_auth_admin;
-- Defense in depth: revoke from anon/authenticated/public so the hook is not callable directly.
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;
