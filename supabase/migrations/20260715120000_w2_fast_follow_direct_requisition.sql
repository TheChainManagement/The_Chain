-- Wave 2 fast-follow: direct requisition creation with one authoritative line.
-- Documents only. This function never touches inventory balances or movements.

create or replace function public.create_direct_requisition(
  p_tenant uuid,
  p_location uuid,
  p_product uuid,
  p_supplier uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_actor uuid
)
returns table (out_requisition_id uuid, out_total numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requisition uuid;
  v_purchase_uom text;
  v_factor numeric;
  v_total numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'bad_qty'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'bad_unit_cost'; end if;
  if not exists (
    select 1 from public.locations l
    where l.tenant_id = p_tenant and l.id = p_location and l.active
  ) then raise exception 'active_location_not_found'; end if;
  if not exists (
    select 1 from public.products p
    where p.tenant_id = p_tenant and p.id = p_product and p.status = 'active'
  ) then raise exception 'product_not_found'; end if;
  if not exists (
    select 1 from public.suppliers s
    where s.tenant_id = p_tenant and s.id = p_supplier and s.status = 'active'
  ) then raise exception 'supplier_not_found'; end if;

  select ps.purchase_uom, ps.purchase_to_stock_factor
    into v_purchase_uom, v_factor
  from public.product_suppliers ps
  where ps.tenant_id = p_tenant
    and ps.product_id = p_product
    and ps.supplier_id = p_supplier;
  if not found then raise exception 'supplier_link_not_found'; end if;

  v_total := round(p_qty * p_unit_cost, 2);
  insert into public.requisitions
    (tenant_id, location_id, source_rfq_id, requested_by_user_id, total)
  values (p_tenant, p_location, null, p_actor, v_total)
  returning id into v_requisition;

  insert into public.requisition_lines
    (tenant_id, requisition_id, line_no, product_id, supplier_id, qty, unit_cost,
     purchase_uom, purchase_to_stock_factor, source_quote_rfq_id, source_quote_line_no)
  values
    (p_tenant, v_requisition, 1, p_product, p_supplier, p_qty, p_unit_cost,
     v_purchase_uom, v_factor, null, null);

  return query select v_requisition, v_total;
end;
$$;

comment on function public.create_direct_requisition(uuid, uuid, uuid, uuid, numeric, numeric, uuid)
is 'Create one direct draft requisition and its first supplier-linked line atomically. Documents only; zero balance writes.';
