-- ============================================================
-- The Chain — Phase 5L: auth role-claim collision fix (CRITICAL)
--
-- Bug (found 2026-06-01 driving a real signup -> bench flow): the access-token
-- hook wrote the member role (owner/planner/...) into the JWT's top-level `role`
-- claim. But `role` is PostgREST's RESERVED claim — it runs `SET ROLE <value>`
-- on every authenticated request. There is no Postgres role named `owner`, so
-- every authenticated PostgREST query failed with `role "owner" does not exist`.
-- The bench gate's membership count was one of those queries, so it returned
-- null and bounced EVERY valid session to /signin. The app was unusable for any
-- logged-in user (and this was deployed).
--
-- Missed by 5H (gate was getUser-only; bench reached via in-flight redirect, no
-- authed PostgREST query) and 5J (claim-integrity tested with injected JWTs at
-- the DB level, never a live PostgREST request that triggers SET ROLE).
--
-- Fix: emit the member role as a NON-reserved custom claim `tenant_role`, and
-- leave `role` alone (stays `authenticated`). jwt_role() reads the new claim.
-- has_role()/is_owner() flow through jwt_role(), so all RLS policies are covered
-- with no policy changes. The app gate reads only tenant_id (unaffected).
-- Existing sessions re-mint correct claims on next login.
-- ============================================================

-- ----- Hook: preserve the 5J membership gate, rename the role claim -----
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

    -- ONLY emit tenant claims when membership is real (5J integrity gate).
    if user_role is not null then
      select t.token_generation into gen from public.tenants t where t.id = active_tenant;
      claims := jsonb_set(claims, '{tenant_id}', to_jsonb(active_tenant::text));
      -- tenant_role, NOT role: `role` is reserved by PostgREST for SET ROLE.
      claims := jsonb_set(claims, '{tenant_role}', to_jsonb(user_role::text));
      if gen is not null then
        claims := jsonb_set(claims, '{token_generation}', to_jsonb(gen));
      end if;
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

-- ----- jwt_role(): read the renamed claim (keep 5K search_path hardening) -----
create or replace function public.jwt_role() returns public.member_role
language sql stable
set search_path = ''
as $$
  select nullif(coalesce(auth.jwt() ->> 'tenant_role', ''), '')::public.member_role
$$;
