-- Block 2 (onboarding) — atomic fresh-path seed RPCs.
--
-- The fresh onboarding path writes several rows per step (product → location →
-- inventory level → minimum stamp; supplier → primary link → minimum stamp).
-- Doing that as separate client calls can leave a partial-state tenant if a
-- later write fails (the "no partial-state tenants" acceptance rule). These
-- SECURITY INVOKER functions run each step as ONE transaction — any failure
-- rolls the whole step back. RLS still applies (invoker's role); tenant_id comes
-- from the verified JWT, never a parameter. Same pattern as link_supplier.

-- ---------------------------------------------------------------- first product
create or replace function public.onboarding_seed_first_product(
  p_sku text,
  p_name text,
  p_unit_of_measure text,
  p_on_hand numeric
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := public.jwt_tenant_id();
  v_product uuid;
  v_location uuid;
begin
  insert into public.products (tenant_id, sku, name, unit_of_measure, status)
    values (v_tenant, p_sku, p_name, nullif(p_unit_of_measure, ''), 'active')
    returning id into v_product;

  -- Provision the first location ("Main" per the fresh-path spec) if none exists.
  select id into v_location
    from public.locations
    where tenant_id = v_tenant
    order by created_at asc
    limit 1;
  if v_location is null then
    insert into public.locations (tenant_id, name, type)
      values (v_tenant, 'Main', 'warehouse')
      returning id into v_location;
  end if;

  insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
    values (v_tenant, v_product, v_location, coalesce(p_on_hand, 0))
    on conflict (tenant_id, product_id, location_id)
      do update set on_hand = excluded.on_hand;

  update public.onboarding_state
    set catalog_minimum_met_at = now()
    where tenant_id = v_tenant
      and catalog_minimum_met_at is null;

  return v_product;
end;
$$;

-- ---------------------------------------------------------------- first supplier
create or replace function public.onboarding_seed_first_supplier(
  p_name text,
  p_lead_time_days int
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := public.jwt_tenant_id();
  v_supplier uuid;
  v_product uuid;
begin
  insert into public.suppliers (tenant_id, name, contact, default_lead_time_days, status)
    values (v_tenant, p_name, '{}'::jsonb, p_lead_time_days, 'active')
    returning id into v_supplier;

  -- The fresh path always creates the product first; the product-supplier edge
  -- is part of the minimum, so a missing product is a real error (rolls back).
  select id into v_product
    from public.products
    where tenant_id = v_tenant
      and status = 'active'
    order by created_at asc
    limit 1;
  if v_product is null then
    raise exception 'Add a product before adding a supplier' using errcode = 'P0001';
  end if;

  update public.product_suppliers
    set is_primary = false
    where tenant_id = v_tenant
      and product_id = v_product
      and is_primary = true;
  insert into public.product_suppliers
    (tenant_id, product_id, supplier_id, unit_cost, lead_time_days, moq, is_primary)
    values (v_tenant, v_product, v_supplier, null, p_lead_time_days, null, true);

  update public.onboarding_state
    set suppliers_minimum_met_at = now()
    where tenant_id = v_tenant
      and suppliers_minimum_met_at is null;

  return v_supplier;
end;
$$;

-- Authenticated callers only; RLS does the per-row authority.
revoke execute on function public.onboarding_seed_first_product(text, text, text, numeric) from public;
revoke execute on function public.onboarding_seed_first_supplier(text, int) from public;
grant execute on function public.onboarding_seed_first_product(text, text, text, numeric) to authenticated;
grant execute on function public.onboarding_seed_first_supplier(text, int) to authenticated;
