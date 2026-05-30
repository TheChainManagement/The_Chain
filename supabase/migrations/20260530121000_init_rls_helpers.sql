-- ============================================================
-- The Chain — RLS helper functions
-- Source: SYSTEM_DESIGN.md §RLS policy matrix + §Auth and security flow
-- ============================================================

-- Read custom JWT claims set by the auth hook (5C-auth-hook migration).
create or replace function jwt_tenant_id() returns uuid
language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'tenant_id', ''), '')::uuid
$$;

create or replace function jwt_role() returns member_role
language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'role', ''), '')::member_role
$$;

create or replace function jwt_token_generation() returns int
language sql stable as $$
  select coalesce((auth.jwt() ->> 'token_generation')::int, 0)
$$;

-- has_role: true if caller's role is one of the listed roles.
create or replace function has_role(variadic required member_role[]) returns bool
language sql stable as $$
  select jwt_role() = any(required)
$$;

create or replace function is_owner() returns bool
language sql stable as $$
  select jwt_role() = 'owner'::member_role
$$;

-- is_token_stale: middleware calls this via RPC to detect stale JWTs after a
-- role change or membership removal. Auth.uid-aware so authenticated only.
create or replace function is_token_stale() returns bool
language plpgsql stable security definer set search_path = public as $$
declare
  current_gen int;
begin
  if jwt_tenant_id() is null then return false; end if;
  select token_generation into current_gen from tenants where id = jwt_tenant_id();
  return coalesce(jwt_token_generation() < current_gen, false);
end;
$$;

grant execute on function jwt_tenant_id() to authenticated;
grant execute on function jwt_role() to authenticated;
grant execute on function jwt_token_generation() to authenticated;
grant execute on function has_role(member_role[]) to authenticated;
grant execute on function is_owner() to authenticated;
grant execute on function is_token_stale() to authenticated;
