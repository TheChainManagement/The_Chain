-- ============================================================
-- Block 11 — atomic convert reorder recommendations → a purchase order
-- ============================================================
-- Promotes one or many OPEN recommendations (same supplier + location) to a
-- single draft PO with one line each, flipping them to 'converted' in the same
-- transaction so a recommendation can never be double-converted and a concurrent
-- double-submit can't mint two POs. Row-locks the recommendations.
--
-- SECURITY INVOKER, service-role caller (the action gate authorizes; PO + lines
-- are member-writable, recommendations member-writable, but we want one atomic
-- unit). unit_cost rides from the primary product_suppliers link.

create or replace function convert_recommendations_to_po(
  p_tenant uuid,
  p_recommendation_ids uuid[]
)
returns table (out_po_id uuid, out_line_count int)
as $$
declare
  v_supplier uuid;
  v_location uuid;
  v_open int;
  v_distinct_supplier int;
  v_distinct_location int;
  v_null_supplier int;
  v_po uuid;
  v_line_no int := 0;
  v_total numeric := 0;
  r record;
  v_cost numeric;
begin
  -- Lock the recommendations in this set, then validate cohesion.
  perform 1 from public.reorder_recommendations
    where tenant_id = p_tenant and id = any(p_recommendation_ids)
    for update;

  select count(*) filter (where status = 'open'),
         count(distinct supplier_id),
         count(*) filter (where supplier_id is null),
         count(distinct location_id)
    into v_open, v_distinct_supplier, v_null_supplier, v_distinct_location
  from public.reorder_recommendations
  where tenant_id = p_tenant and id = any(p_recommendation_ids);

  if v_open = 0 then raise exception 'no_recommendations'; end if;
  if v_open <> array_length(p_recommendation_ids, 1) then raise exception 'not_open'; end if;
  if v_distinct_supplier = 0 or v_null_supplier > 0 then raise exception 'no_supplier'; end if;
  if v_distinct_supplier <> 1 then raise exception 'mixed_supplier'; end if;
  if v_distinct_location <> 1 then raise exception 'mixed_location'; end if;

  -- Validation passed (exactly one supplier + location across the set).
  select supplier_id, location_id into v_supplier, v_location
  from public.reorder_recommendations
  where tenant_id = p_tenant and id = any(p_recommendation_ids)
  limit 1;

  insert into public.purchase_orders
    (tenant_id, supplier_id, location_id, status, recommended_by, total)
  values (p_tenant, v_supplier, v_location, 'draft', 'system', 0)
  returning id into v_po;

  for r in
    select rr.id, rr.product_id, rr.recommended_qty
    from public.reorder_recommendations rr
    where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids)
    order by rr.product_id
  loop
    v_line_no := v_line_no + 1;
    select unit_cost into v_cost
      from public.product_suppliers
      where tenant_id = p_tenant and product_id = r.product_id and supplier_id = v_supplier
      limit 1;

    insert into public.purchase_order_lines
      (tenant_id, po_id, line_no, product_id, recommended_qty, ordered_qty, unit_cost)
    values (p_tenant, v_po, v_line_no, r.product_id, r.recommended_qty, r.recommended_qty, v_cost);

    v_total := v_total + coalesce(v_cost, 0) * r.recommended_qty;

    update public.reorder_recommendations
      set status = 'converted', updated_at = now()
      where id = r.id;
  end loop;

  update public.purchase_orders set total = v_total where id = v_po;

  return query select v_po, v_line_no;
end;
$$ language plpgsql security invoker set search_path = '';

comment on function convert_recommendations_to_po(uuid, uuid[]) is
  'Atomically promote OPEN same-supplier/same-location reorder recommendations '
  'to one draft PO (one line each) and mark them converted. Row-locked.';
