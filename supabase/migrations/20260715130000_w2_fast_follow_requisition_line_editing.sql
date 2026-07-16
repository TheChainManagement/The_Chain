-- Wave 2 fast-follow: editable draft/rejected requisition lines.
-- Documents only. These functions never touch inventory balances or movements.

create or replace function public.save_requisition_line(
  p_tenant uuid,
  p_requisition uuid,
  p_line_no integer,
  p_product uuid,
  p_supplier uuid,
  p_qty numeric,
  p_unit_cost numeric
)
returns table (out_line_no integer, out_total numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.requisition_status;
  v_line_no integer;
  v_purchase_uom text;
  v_factor numeric;
  v_total numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'bad_qty'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'bad_unit_cost'; end if;

  select r.status into v_status
  from public.requisitions r
  where r.tenant_id = p_tenant and r.id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if v_status not in ('draft', 'rejected') then raise exception 'requisition_not_editable'; end if;

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

  if p_line_no is null then
    select coalesce(max(rl.line_no), 0) + 1 into v_line_no
    from public.requisition_lines rl
    where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition;
    insert into public.requisition_lines
      (tenant_id, requisition_id, line_no, product_id, supplier_id, qty, unit_cost,
       purchase_uom, purchase_to_stock_factor, source_quote_rfq_id, source_quote_line_no)
    values
      (p_tenant, p_requisition, v_line_no, p_product, p_supplier, p_qty, p_unit_cost,
       v_purchase_uom, v_factor, null, null);
  else
    v_line_no := p_line_no;
    update public.requisition_lines rl
       set product_id = p_product,
           supplier_id = p_supplier,
           qty = p_qty,
           unit_cost = p_unit_cost,
           purchase_uom = v_purchase_uom,
           purchase_to_stock_factor = v_factor,
           source_quote_rfq_id = null,
           source_quote_line_no = null
     where rl.tenant_id = p_tenant
       and rl.requisition_id = p_requisition
       and rl.line_no = p_line_no;
    if not found then raise exception 'requisition_line_not_found'; end if;
  end if;

  select round(coalesce(sum(rl.qty * rl.unit_cost), 0), 2) into v_total
  from public.requisition_lines rl
  where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition;
  update public.requisitions r set total = v_total
  where r.tenant_id = p_tenant and r.id = p_requisition;
  return query select v_line_no, v_total;
end;
$$;

comment on function public.save_requisition_line(uuid, uuid, integer, uuid, uuid, numeric, numeric)
is 'Add or edit a draft/rejected requisition line, clear quote lineage on edit, and recalculate total. Documents only.';
