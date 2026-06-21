-- ============================================================
-- The Chain — Block 16 (Billing): signup creates an 'incomplete' subscription.
--
-- Replaces the 14-day trial bootstrap. Hard paywall (MG 2026-06-21): a new tenant
-- starts with NO access (status 'incomplete', no trial dates). The gated plan
-- picker → Stripe checkout flips it to 'active' (webhook + success-page reconcile).
-- Everything else about the atomic owner-graph bootstrap is unchanged.
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

  -- No trial: the tenant has no access until checkout activates the subscription.
  insert into public.subscriptions (tenant_id, status, retention_tier)
    values (v_tenant, 'incomplete', 'free');

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
  'Signup bootstrap (Block 16). Atomically creates tenant + owner membership + '
  'an incomplete (unpaid, no-access) subscription + profile + first audit row. '
  'Stripe checkout activates the subscription.';

grant execute on function public.bootstrap_tenant(text) to authenticated;
revoke execute on function public.bootstrap_tenant(text) from anon, public;
