-- ============================================================
-- The Chain — W2-3d: convert_requisition_to_po
-- Source: docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md §4 (conversion contract)
-- ============================================================
--
-- An APPROVED requisition becomes purchase orders: one PO per supplier at the
-- requisition's location (a mixed-vendor requisition fans out to N POs).
-- Requisition lines are already purchase-UoM with the quote's cost snapshot,
-- so PO lines are a straight copy — the same basis convert_recommendations_to_po
-- produces. ZERO balance writes here: in_transit commits later at PO approval
-- (apply_po_approval, the kernel surface), receipts post through the kernel.
--
-- Row-locked and idempotent: a requisition already converted returns its
-- existing POs with out_applied = false instead of double-creating.
-- SECURITY INVOKER, member caller (owner|manager|planner per RLS); the
-- APPROVAL gate (single-step, owner+manager, no self-approval — MG 2026-07-12)
-- lives in the Server Action, which only calls this for approved documents.

create or replace function convert_requisition_to_po(
  p_tenant uuid,
  p_requisition uuid
)
returns table (out_po_id uuid, out_supplier_id uuid, out_line_count int, out_applied bool)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_req record;
  v_supplier uuid;
  v_po uuid;
  v_line record;
  v_line_no int;
  v_total numeric;
begin
  select id, status, location_id
    into v_req
  from public.requisitions
  where tenant_id = p_tenant and id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;

  -- Idempotent replay: already converted → hand back the existing POs.
  if v_req.status = 'converted' then
    return query
      select po.id, po.supplier_id,
             (select count(*)::int from public.purchase_order_lines pol
               where pol.tenant_id = p_tenant and pol.po_id = po.id),
             false
      from public.purchase_orders po
      where po.tenant_id = p_tenant and po.requisition_id = p_requisition;
    return;
  end if;

  if v_req.status <> 'approved' then raise exception 'not_approved'; end if;

  perform 1 from public.requisition_lines
    where tenant_id = p_tenant and requisition_id = p_requisition;
  if not found then raise exception 'no_lines'; end if;

  for v_supplier in
    select distinct rl.supplier_id
    from public.requisition_lines rl
    where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
    order by rl.supplier_id
  loop
    v_line_no := 0;
    v_total := 0;

    insert into public.purchase_orders
      (tenant_id, supplier_id, location_id, status, recommended_by, requisition_id, total)
    values (p_tenant, v_supplier, v_req.location_id, 'draft', 'user', p_requisition, 0)
    returning id into v_po;

    for v_line in
      select rl.product_id, rl.qty, rl.unit_cost
      from public.requisition_lines rl
      where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
        and rl.supplier_id = v_supplier
      order by rl.line_no
    loop
      v_line_no := v_line_no + 1;
      insert into public.purchase_order_lines
        (tenant_id, po_id, line_no, product_id, ordered_qty, unit_cost)
      values (p_tenant, v_po, v_line_no, v_line.product_id, v_line.qty, v_line.unit_cost);
      v_total := v_total + coalesce(v_line.unit_cost, 0) * v_line.qty;
    end loop;

    update public.purchase_orders set total = v_total
      where tenant_id = p_tenant and id = v_po;

    return query select v_po, v_supplier, v_line_no, true;
  end loop;

  update public.requisitions
    set status = 'converted', updated_at = now()
    where tenant_id = p_tenant and id = p_requisition;
end;
$$;

comment on function convert_requisition_to_po(uuid, uuid) is
  'W2-3d: promote an APPROVED requisition to draft purchase orders — one PO per '
  'supplier at the requisition location, lines copied on the purchase-UoM basis '
  'they already carry, purchase_orders.requisition_id back-referenced. Row-locked; '
  'replay on a converted requisition returns the existing POs with '
  'out_applied=false. Writes documents only — no balance table is touched.';
