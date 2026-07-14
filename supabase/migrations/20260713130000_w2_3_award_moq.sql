-- ============================================================
-- The Chain - W2-3 award MOQ correction
-- ============================================================
-- The quoted MOQ is part of the vendor's commercial offer. Award quantity is
-- therefore the greater of converted stock demand and the quoted purchase-unit
-- minimum. Keep the atomic database calculation aligned with the comparison
-- tray preview.

create or replace function public.award_rfq_quotes_to_requisition(
  p_tenant uuid,
  p_rfq uuid,
  p_picks jsonb
)
returns table (out_requisition_id uuid, out_total numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rfq record;
  v_req uuid;
  v_total numeric;
  v_pick_count int;
  v_match_count int;
begin
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) = 0 then
    raise exception 'no_picks';
  end if;

  select id, status, location_id into v_rfq
  from public.rfqs
  where tenant_id = p_tenant and id = p_rfq
  for update;
  if not found then raise exception 'rfq_not_found'; end if;
  if v_rfq.status not in ('sent', 'quoted') then raise exception 'rfq_not_open'; end if;

  with picks as (
    select (p.value->>'lineNo')::int as line_no,
           (p.value->>'supplierId')::uuid as supplier_id
    from jsonb_array_elements(p_picks) p(value)
  )
  select count(*), count(distinct line_no) into v_pick_count, v_match_count from picks;
  if v_pick_count <> v_match_count then raise exception 'duplicate_line_pick'; end if;

  with picks as (
    select (p.value->>'lineNo')::int as line_no,
           (p.value->>'supplierId')::uuid as supplier_id
    from jsonb_array_elements(p_picks) p(value)
  ), matched as (
    select l.line_no
    from picks p
    join public.rfq_lines l
      on l.tenant_id = p_tenant and l.rfq_id = p_rfq and l.line_no = p.line_no
    join public.rfq_vendor_quotes q
      on q.tenant_id = l.tenant_id and q.rfq_id = l.rfq_id
     and q.line_no = l.line_no and q.supplier_id = p.supplier_id
    for update of l, q
  )
  select count(*) into v_match_count from matched;
  if v_match_count <> v_pick_count then raise exception 'quote_pick_not_found'; end if;

  with picks as (
    select (p.value->>'lineNo')::int as line_no,
           (p.value->>'supplierId')::uuid as supplier_id
    from jsonb_array_elements(p_picks) p(value)
  )
  select round(sum(
    greatest(
      l.qty / coalesce(q.purchase_to_stock_factor, 1),
      coalesce(q.moq, 0)
    ) * q.quoted_unit_cost
  ), 2)
    into v_total
  from picks p
  join public.rfq_lines l
    on l.tenant_id = p_tenant and l.rfq_id = p_rfq and l.line_no = p.line_no
  join public.rfq_vendor_quotes q
    on q.tenant_id = l.tenant_id and q.rfq_id = l.rfq_id
   and q.line_no = l.line_no and q.supplier_id = p.supplier_id;

  insert into public.requisitions
    (tenant_id, location_id, source_rfq_id, requested_by_user_id, total)
  values (p_tenant, v_rfq.location_id, p_rfq, auth.uid(), v_total)
  returning id into v_req;

  with picks as (
    select (p.value->>'lineNo')::int as source_line_no,
           (p.value->>'supplierId')::uuid as supplier_id,
           p.ordinality::int as award_line_no
    from jsonb_array_elements(p_picks) with ordinality p(value, ordinality)
  )
  insert into public.requisition_lines
    (tenant_id, requisition_id, line_no, product_id, supplier_id, qty,
     unit_cost, purchase_uom, purchase_to_stock_factor,
     source_quote_rfq_id, source_quote_line_no)
  select p_tenant, v_req, p.award_line_no, l.product_id, p.supplier_id,
         greatest(
           l.qty / coalesce(q.purchase_to_stock_factor, 1),
           coalesce(q.moq, 0)
         ),
         q.quoted_unit_cost, q.quoted_purchase_uom, q.purchase_to_stock_factor,
         p_rfq, l.line_no
  from picks p
  join public.rfq_lines l
    on l.tenant_id = p_tenant and l.rfq_id = p_rfq and l.line_no = p.source_line_no
  join public.rfq_vendor_quotes q
    on q.tenant_id = l.tenant_id and q.rfq_id = l.rfq_id
   and q.line_no = l.line_no and q.supplier_id = p.supplier_id
  order by p.award_line_no;

  return query select v_req, v_total;
end;
$$;

comment on function public.award_rfq_quotes_to_requisition(uuid, uuid, jsonb) is
  'Atomically award authoritative RFQ quote snapshots into one draft requisition. Purchase quantity honors quoted MOQ. Documents only; zero balance writes.';
