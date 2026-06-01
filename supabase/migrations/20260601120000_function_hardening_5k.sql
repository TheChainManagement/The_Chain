-- ============================================================
-- The Chain — Phase 5K: function hardening
-- Source: Supabase security advisor run against the hosted project
--   (hdpivaufoqokeuzgftsj) on 2026-06-01, first lint against cloud infra.
--
-- Clears the legitimate WARN-level findings the local probes + Codex 5J
-- review never surfaced (they never ran the hosted linter):
--   1. function_search_path_mutable on 7 early (5A-5C) helper/trigger fns.
--   2. SECURITY DEFINER trigger fns (capture_audit, enforce_po_recommendation_tenant)
--      left callable via /rest/v1/rpc by anon + authenticated.
--
-- Explicitly ACCEPTED (not changed), documented for the next reviewer:
--   - bootstrap_tenant(text): authenticated MUST call it right after signup.
--   - is_token_stale(): the auth middleware calls it via RPC every request
--     (src/lib/supabase/middleware.ts). It already pins search_path = public.
--   - citext-in-public: low-risk WARN, deferred to the stack-audit backlog
--     (moving an in-use extension is riskier than the finding).
-- ============================================================

-- ----- 1. Pin search_path on the 5A-5C helpers -----
-- Empty search_path is the hardening default already used by 5F/5J fns.
-- These were written before that convention, so refs are unqualified here;
-- recreate with fully-qualified names so an empty path is safe.

create or replace function public.jwt_tenant_id() returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(coalesce(auth.jwt() ->> 'tenant_id', ''), '')::uuid
$$;

create or replace function public.jwt_role() returns public.member_role
language sql stable
set search_path = ''
as $$
  select nullif(coalesce(auth.jwt() ->> 'role', ''), '')::public.member_role
$$;

create or replace function public.jwt_token_generation() returns int
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'token_generation')::int, 0)
$$;

create or replace function public.has_role(variadic required public.member_role[]) returns bool
language sql stable
set search_path = ''
as $$
  select public.jwt_role() = any(required)
$$;

create or replace function public.is_owner() returns bool
language sql stable
set search_path = ''
as $$
  select public.jwt_role() = 'owner'::public.member_role
$$;

-- ----- 2. Pin search_path on the two early trigger functions -----

create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bump_tenant_token_generation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'UPDATE' and new.role is distinct from old.role) or tg_op = 'DELETE' then
    update public.tenants
      set token_generation = token_generation + 1
      where id = coalesce(new.tenant_id, old.tenant_id);
  end if;
  return coalesce(new, old);
end;
$$;

-- ----- 3. Close trigger-only functions to direct RPC -----
-- capture_audit + enforce_po_recommendation_tenant only run inside triggers,
-- which fire as the function owner regardless of caller EXECUTE. Revoking the
-- default PUBLIC grant removes the /rest/v1/rpc exposure without affecting the
-- triggers. revoke from public (the default-grant source) + the named roles.

revoke execute on function public.capture_audit() from public, anon, authenticated;
revoke execute on function public.enforce_po_recommendation_tenant() from public, anon, authenticated;
