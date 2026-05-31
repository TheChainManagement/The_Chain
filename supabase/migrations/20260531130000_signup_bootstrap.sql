-- ============================================================
-- The Chain — Phase 5H: tenant bootstrap RPC for self-serve signup
-- Source: FEATURES.md §Account creation + sign-in (atomic tenant creation)
--
-- One SECURITY DEFINER function = one transaction. Called by the signup Server
-- Action as the freshly-created authenticated user (auth.uid()). It creates the
-- whole owner graph atomically: tenant + owner membership + trial subscription +
-- profile (active_tenant_id) + the first audit_log row. If any insert fails the
-- whole thing rolls back, so there are never orphan rows.
--
-- Phase 6 ("Account creation + sign-in") hardens copy, the bench transition, and
-- the deliberate transaction-abort test; the atomic shape lives here from 5H so
-- the auth gate is reachable.
-- ============================================================

create or replace function public.bootstrap_tenant(p_business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'bootstrap_tenant requires an authenticated user';
  end if;

  if coalesce(btrim(p_business_name), '') = '' then
    raise exception 'business name is required';
  end if;

  -- Slug: kebab the name, append a short uuid fragment to guarantee uniqueness.
  v_slug :=
    left(regexp_replace(lower(btrim(p_business_name)), '[^a-z0-9]+', '-', 'g'), 40)
    || '-'
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_slug := btrim(v_slug, '-');

  insert into public.tenants (name, slug)
    values (btrim(p_business_name), v_slug)
    returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_uid, 'owner');

  insert into public.subscriptions (tenant_id, status, trial_start, trial_end, retention_tier)
    values (v_tenant, 'trial', now(), now() + interval '14 days', 'free');

  insert into public.profiles (user_id, active_tenant_id)
    values (v_uid, v_tenant)
  on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;

  insert into public.audit_log (tenant_id, actor_user_id, entity_type, entity_id, action, before, after)
    values (
      v_tenant, v_uid, 'tenants', v_tenant, 'tenant.created',
      '{}'::jsonb,
      jsonb_build_object('name', btrim(p_business_name), 'slug', v_slug, 'owner', v_uid)
    );

  return v_tenant;
end;
$$;

comment on function public.bootstrap_tenant(text) is
  'Phase 5H signup bootstrap. Atomically creates tenant + owner membership + '
  'trial subscription + profile + first audit row for the calling user.';

grant execute on function public.bootstrap_tenant(text) to authenticated;
revoke execute on function public.bootstrap_tenant(text) from anon, public;
