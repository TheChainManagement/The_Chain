-- ============================================================
-- The Chain — Phase 6 Block 4: atomic product↔supplier link RPCs
-- Source: Codex review 2026-06-02 (_reviews/2026-06-02_blocks-3-4-inventory-
--   suppliers.md, "primary-supplier swap is not atomic"). The app did clear-then-
--   set across two PostgREST round-trips, so a failed/raced second write could
--   leave a SKU with no primary. These functions do it in ONE transaction.
--
-- SECURITY INVOKER (default): RLS on product_suppliers still applies, so the
--   has_role('owner','manager','planner') insert/update gate is enforced for the
--   caller. tenant_id comes from jwt_tenant_id(); a caller cannot target another
--   tenant. search_path = '' per the 5K hardening convention (fully-qualified).
-- The partial unique index product_suppliers_one_primary is never violated:
--   the existing primary is cleared before the new one is set/inserted.
-- ============================================================

-- Atomically move the primary flag to an existing link.
create or replace function public.set_primary_supplier(
  p_product_id uuid,
  p_supplier_id uuid
) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.product_suppliers
    set is_primary = false
    where tenant_id = public.jwt_tenant_id()
      and product_id = p_product_id
      and is_primary = true
      and supplier_id <> p_supplier_id;

  update public.product_suppliers
    set is_primary = true
    where tenant_id = public.jwt_tenant_id()
      and product_id = p_product_id
      and supplier_id = p_supplier_id;

  if not found then
    raise exception 'supplier link not found for product %', p_product_id
      using errcode = 'no_data_found';
  end if;
end;
$$;

-- Atomically create a link, optionally as the primary (clears any prior primary).
create or replace function public.link_supplier(
  p_product_id uuid,
  p_supplier_id uuid,
  p_unit_cost numeric,
  p_lead_time_days int,
  p_moq int,
  p_is_primary boolean
) returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(p_is_primary, false) then
    update public.product_suppliers
      set is_primary = false
      where tenant_id = public.jwt_tenant_id()
        and product_id = p_product_id
        and is_primary = true;
  end if;

  insert into public.product_suppliers
    (tenant_id, product_id, supplier_id, unit_cost, lead_time_days, moq, is_primary)
    values (public.jwt_tenant_id(), p_product_id, p_supplier_id,
            p_unit_cost, p_lead_time_days, p_moq, coalesce(p_is_primary, false));
end;
$$;

-- Lock down the rpc surface: authenticated callers only (RLS does the rest).
revoke execute on function public.set_primary_supplier(uuid, uuid) from public;
revoke execute on function public.link_supplier(uuid, uuid, numeric, int, int, boolean) from public;
grant execute on function public.set_primary_supplier(uuid, uuid) to authenticated;
grant execute on function public.link_supplier(uuid, uuid, numeric, int, int, boolean) to authenticated;
