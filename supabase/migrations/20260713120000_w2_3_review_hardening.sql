-- ============================================================
-- The Chain - W2-3 adversarial review hardening
-- ============================================================
-- New migration only: the three earlier W2-3 migrations were already applied
-- locally. This closes tenant-lineage, atomicity, approval, and UoM snapshot
-- findings without rewriting migration history.

-- Tenant-scoped parent keys for every new header relationship.
alter table public.rfqs
  add constraint rfqs_tenant_id_id_key unique (tenant_id, id);
alter table public.requisitions
  add constraint requisitions_tenant_id_id_key unique (tenant_id, id);
alter table public.rfq_lines
  add constraint rfq_lines_tenant_rfq_line_key unique (tenant_id, rfq_id, line_no);
alter table public.rfq_vendors
  add constraint rfq_vendors_tenant_rfq_supplier_key unique (tenant_id, rfq_id, supplier_id);
alter table public.rfq_vendor_quotes
  add constraint rfq_vendor_quotes_tenant_source_key
  unique (tenant_id, rfq_id, supplier_id, line_no);

-- Replace globally keyed parent references with tenant-scoped references.
alter table public.rfq_lines drop constraint rfq_lines_rfq_id_fkey;
alter table public.rfq_lines add constraint rfq_lines_rfq_id_fkey
  foreign key (tenant_id, rfq_id)
  references public.rfqs (tenant_id, id) on delete cascade;

alter table public.rfq_vendors drop constraint rfq_vendors_rfq_id_fkey;
alter table public.rfq_vendors add constraint rfq_vendors_rfq_id_fkey
  foreign key (tenant_id, rfq_id)
  references public.rfqs (tenant_id, id) on delete cascade;

alter table public.rfq_vendor_quotes drop constraint rfq_vendor_quotes_rfq_id_fkey;
alter table public.rfq_vendor_quotes add constraint rfq_vendor_quotes_rfq_id_fkey
  foreign key (tenant_id, rfq_id)
  references public.rfqs (tenant_id, id) on delete cascade;

alter table public.rfq_vendor_quotes drop constraint rfq_vendor_quotes_rfq_id_line_no_fkey;
alter table public.rfq_vendor_quotes add constraint rfq_vendor_quotes_rfq_id_line_no_fkey
  foreign key (tenant_id, rfq_id, line_no)
  references public.rfq_lines (tenant_id, rfq_id, line_no) on delete cascade;

alter table public.rfq_vendor_quotes drop constraint rfq_vendor_quotes_rfq_id_supplier_id_fkey;
alter table public.rfq_vendor_quotes add constraint rfq_vendor_quotes_rfq_id_supplier_id_fkey
  foreign key (tenant_id, rfq_id, supplier_id)
  references public.rfq_vendors (tenant_id, rfq_id, supplier_id) on delete cascade;

alter table public.requisitions drop constraint requisitions_source_rfq_id_fkey;
alter table public.requisitions add constraint requisitions_source_rfq_id_fkey
  foreign key (tenant_id, source_rfq_id)
  references public.rfqs (tenant_id, id) on delete set null (source_rfq_id);

alter table public.requisition_lines drop constraint requisition_lines_requisition_id_fkey;
alter table public.requisition_lines add constraint requisition_lines_requisition_id_fkey
  foreign key (tenant_id, requisition_id)
  references public.requisitions (tenant_id, id) on delete cascade;

alter table public.purchase_orders drop constraint purchase_orders_requisition_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_requisition_id_fkey
  foreign key (tenant_id, requisition_id)
  references public.requisitions (tenant_id, id) on delete set null (requisition_id);

-- A requisition line now carries an enforceable reference to the exact winning
-- quote. Direct requisitions leave both source columns null.
alter table public.requisition_lines
  add column source_quote_rfq_id uuid;

update public.requisition_lines rl
set source_quote_rfq_id = r.source_rfq_id
from public.requisitions r
where r.tenant_id = rl.tenant_id
  and r.id = rl.requisition_id
  and rl.source_quote_line_no is not null;

alter table public.requisition_lines add constraint requisition_lines_source_quote_fkey
  foreign key (tenant_id, source_quote_rfq_id, supplier_id, source_quote_line_no)
  references public.rfq_vendor_quotes (tenant_id, rfq_id, supplier_id, line_no)
  on delete set null (source_quote_rfq_id, source_quote_line_no);

-- Procurement quote snapshots must survive supplier-link edits all the way
-- through PO approval and receipt. Existing POs remain null and use the legacy
-- supplier-link fallback.
alter table public.purchase_order_lines
  add column purchase_uom text,
  add column purchase_to_stock_factor numeric(14,4);
alter table public.purchase_order_lines add constraint purchase_order_lines_factor_check
  check (purchase_to_stock_factor is null or purchase_to_stock_factor > 0);

-- Authenticated callers cannot move tenant ownership, forge decision metadata,
-- or bypass the no-self-approval rule with direct PostgREST updates. Superuser
-- and service operations without a tenant JWT keep the established maintenance
-- path.
create or replace function public.enforce_requisition_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.tenant_id <> old.tenant_id then
    raise exception 'tenant_immutable';
  end if;

  if public.jwt_tenant_id() is null then
    return new;
  end if;

  if new.requested_by_user_id is distinct from old.requested_by_user_id then
    raise exception 'requester_immutable';
  end if;

  if new.status in ('approved', 'rejected') and new.status is distinct from old.status then
    if old.status <> 'submitted' then raise exception 'bad_requisition_transition'; end if;
    if not public.has_role('owner', 'manager') then raise exception 'approval_forbidden'; end if;
    if v_actor is null or old.requested_by_user_id is null or v_actor = old.requested_by_user_id then
      raise exception 'self_approval_forbidden';
    end if;
    if new.approved_by_user_id is distinct from v_actor or new.decided_at is null then
      raise exception 'decision_metadata_invalid';
    end if;
    if new.status = 'rejected' and nullif(btrim(coalesce(new.rejection_note, '')), '') is null then
      raise exception 'rejection_note_required';
    end if;
  elsif new.approved_by_user_id is distinct from old.approved_by_user_id
     or new.decided_at is distinct from old.decided_at then
    raise exception 'decision_metadata_guarded';
  end if;

  return new;
end;
$$;

create trigger requisitions_enforce_update
before update on public.requisitions
for each row execute function public.enforce_requisition_update();

-- Row-locked, database-enforced requisition decision boundary.
create or replace function public.decide_requisition(
  p_tenant uuid,
  p_requisition uuid,
  p_decision text,
  p_rejection_note text default null
)
returns table (out_status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_req record;
  v_actor uuid := auth.uid();
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'bad_decision'; end if;
  if not public.has_role('owner', 'manager') then raise exception 'approval_forbidden'; end if;

  select id, status, requested_by_user_id into v_req
  from public.requisitions
  where tenant_id = p_tenant and id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if v_req.status <> 'submitted' then raise exception 'not_submitted'; end if;
  if v_actor is null or v_req.requested_by_user_id is null or v_actor = v_req.requested_by_user_id then
    raise exception 'self_approval_forbidden';
  end if;
  if p_decision = 'rejected'
     and nullif(btrim(coalesce(p_rejection_note, '')), '') is null then
    raise exception 'rejection_note_required';
  end if;

  update public.requisitions
  set status = p_decision::public.requisition_status,
      approved_by_user_id = v_actor,
      decided_at = now(),
      rejection_note = case when p_decision = 'rejected' then btrim(p_rejection_note) else null end
  where tenant_id = p_tenant and id = p_requisition;

  return query select p_decision;
end;
$$;

-- Award math and header/line creation are one database transaction. The RFQ,
-- picked lines, and quote rows are locked while the purchase-basis quantities
-- and rounded document total are derived from authoritative snapshots.
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
  select round(sum((l.qty / coalesce(q.purchase_to_stock_factor, 1)) * q.quoted_unit_cost), 2)
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
         l.qty / coalesce(q.purchase_to_stock_factor, 1),
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

-- Replace conversion so the immutable quote UoM/factor snapshot rides to each
-- PO line. Lock child lines before fan-out so an in-flight edit cannot split
-- totals from copied lines.
create or replace function public.convert_requisition_to_po(
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
  select id, status, location_id into v_req
  from public.requisitions
  where tenant_id = p_tenant and id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;

  if v_req.status = 'converted' then
    return query
      select po.id, po.supplier_id,
             (select count(*)::int from public.purchase_order_lines pol
               where pol.tenant_id = p_tenant and pol.po_id = po.id), false
      from public.purchase_orders po
      where po.tenant_id = p_tenant and po.requisition_id = p_requisition;
    return;
  end if;
  if v_req.status <> 'approved' then raise exception 'not_approved'; end if;

  perform 1 from public.requisition_lines
  where tenant_id = p_tenant and requisition_id = p_requisition
  for update;
  if not found then raise exception 'no_lines'; end if;

  for v_supplier in
    select distinct rl.supplier_id from public.requisition_lines rl
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
      select rl.product_id, rl.qty, rl.unit_cost, rl.purchase_uom, rl.purchase_to_stock_factor
      from public.requisition_lines rl
      where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
        and rl.supplier_id = v_supplier
      order by rl.line_no
    loop
      v_line_no := v_line_no + 1;
      insert into public.purchase_order_lines
        (tenant_id, po_id, line_no, product_id, ordered_qty, unit_cost,
         purchase_uom, purchase_to_stock_factor)
      values (p_tenant, v_po, v_line_no, v_line.product_id, v_line.qty, v_line.unit_cost,
              v_line.purchase_uom, v_line.purchase_to_stock_factor);
      v_total := v_total + coalesce(v_line.unit_cost, 0) * v_line.qty;
    end loop;

    update public.purchase_orders set total = round(v_total, 2)
    where tenant_id = p_tenant and id = v_po;
    return query select v_po, v_supplier, v_line_no, true;
  end loop;

  update public.requisitions set status = 'converted', updated_at = now()
  where tenant_id = p_tenant and id = p_requisition;
end;
$$;

-- PO receipt prefers the immutable line factor and falls back to the current
-- supplier link only for legacy/non-procurement lines without a snapshot.
create or replace function public.receive_purchase_order(
  p_tenant uuid,
  p_po uuid,
  p_delivered_at timestamptz,
  p_lines jsonb,
  p_idempotency_key text
)
returns table (out_status text, out_supplier_id uuid, out_event_qty numeric, out_applied bool)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_po record; v_line record; v_add numeric; v_next numeric; v_delta numeric;
  v_factor numeric; v_stock_qty numeric; v_stock_cost numeric;
  v_ordered numeric := 0; v_received numeric := 0; v_event numeric := 0;
  v_in_full bool; v_on_time bool; v_otif bool; v_status text;
begin
  select id, supplier_id, location_id, status, expected_delivery_at into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;

  insert into public.po_receipt_events (tenant_id, po_id, idempotency_key, event_qty)
  values (p_tenant, p_po, p_idempotency_key, 0)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select v_po.status::text, v_po.supplier_id, 0::numeric, false;
    return;
  end if;
  if v_po.status in ('received', 'closed', 'canceled') then raise exception 'po_terminal'; end if;

  for v_line in
    select pol.line_no, pol.product_id, pol.ordered_qty, pol.received_qty, pol.unit_cost,
           coalesce(pol.purchase_to_stock_factor, ps.purchase_to_stock_factor) as purchase_to_stock_factor
    from public.purchase_order_lines pol
    left join public.product_suppliers ps
      on ps.tenant_id = pol.tenant_id and ps.product_id = pol.product_id
     and ps.supplier_id = v_po.supplier_id
    where pol.tenant_id = p_tenant and pol.po_id = p_po
  loop
    v_add := coalesce((p_lines ->> v_line.line_no::text)::numeric, 0);
    if v_add < 0 then v_add := 0; end if;
    v_next := least(v_line.ordered_qty, v_line.received_qty + v_add);
    v_delta := v_next - v_line.received_qty;
    v_ordered := v_ordered + v_line.ordered_qty;
    v_received := v_received + v_next;
    v_event := v_event + v_delta;
    if v_delta > 0 then
      update public.purchase_order_lines set received_qty = v_next
      where tenant_id = p_tenant and po_id = p_po and line_no = v_line.line_no;
      v_factor := coalesce(v_line.purchase_to_stock_factor, 1);
      v_stock_qty := v_delta * v_factor;
      v_stock_cost := case when v_line.unit_cost is null then null else v_line.unit_cost / v_factor end;
      perform public.post_stock_movement(
        p_tenant, v_line.product_id, v_po.location_id, 'receipt', v_stock_qty, 'workflow',
        'receipt:po=' || p_po::text || ':line=' || v_line.line_no::text || ':key=' || p_idempotency_key,
        p_delivered_at, null, null, null, null, v_stock_cost, true);
    end if;
  end loop;
  if v_event <= 0 then raise exception 'nothing_received'; end if;

  update public.po_receipt_events set event_qty = v_event
  where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  v_in_full := v_received >= v_ordered;
  v_status := case when v_in_full then 'received' else 'partial_received' end;
  if v_po.expected_delivery_at is null then v_on_time := null;
  else v_on_time := (p_delivered_at at time zone 'UTC')::date
                    <= (v_po.expected_delivery_at at time zone 'UTC')::date;
  end if;
  v_otif := coalesce(v_on_time, true) and v_in_full;
  update public.purchase_orders set status = v_status::public.po_status, actual_delivery_at = p_delivered_at
  where tenant_id = p_tenant and id = p_po;
  insert into public.supplier_performance
    (tenant_id, supplier_id, po_id, promised_delivery_at, actual_delivery_at,
     promised_quantity, actual_quantity, on_time, in_full, on_time_in_full)
  values (p_tenant, v_po.supplier_id, p_po, v_po.expected_delivery_at, p_delivered_at,
          v_ordered, v_event, v_on_time, v_in_full, v_otif);
  return query select v_status, v_po.supplier_id, v_event, true;
end;
$$;

-- PO approval uses the same snapshot/fallback rule, keeping in_transit and the
-- later receipt on one conversion basis.
create or replace function public.apply_po_approval(
  p_tenant uuid,
  p_po uuid,
  p_target_status text,
  p_external_po_id text default null,
  p_external_reference text default null,
  p_external_version int default null
)
returns table (out_status text, out_applied bool)
language plpgsql
security invoker
set search_path = ''
as $$
declare v_po record; v_line record;
begin
  if p_target_status not in ('sent', 'exported') then raise exception 'bad_target_status'; end if;
  select id, status, location_id, supplier_id into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if v_po.status not in ('draft', 'recommended') then
    return query select v_po.status::text, false;
    return;
  end if;

  for v_line in
    select pol.product_id,
           pol.ordered_qty * coalesce(pol.purchase_to_stock_factor, ps.purchase_to_stock_factor, 1) as stock_qty
    from public.purchase_order_lines pol
    left join public.product_suppliers ps
      on ps.tenant_id = pol.tenant_id and ps.product_id = pol.product_id
     and ps.supplier_id = v_po.supplier_id
    where pol.tenant_id = p_tenant and pol.po_id = p_po
  loop
    insert into public.inventory_levels (tenant_id, product_id, location_id, in_transit)
    values (p_tenant, v_line.product_id, v_po.location_id, v_line.stock_qty)
    on conflict (tenant_id, product_id, location_id)
    do update set in_transit = public.inventory_levels.in_transit + excluded.in_transit;
  end loop;

  update public.purchase_orders
  set status = p_target_status::public.po_status,
      external_po_id = coalesce(p_external_po_id, external_po_id),
      external_reference = coalesce(p_external_reference, external_reference),
      external_version = coalesce(p_external_version, external_version),
      last_synced_at = case when p_external_po_id is not null then now() else last_synced_at end
  where tenant_id = p_tenant and id = p_po;
  return query select p_target_status, true;
end;
$$;

comment on function public.award_rfq_quotes_to_requisition(uuid, uuid, jsonb) is
  'Atomically award authoritative RFQ quote snapshots into one draft requisition. Documents only; zero balance writes.';
comment on function public.decide_requisition(uuid, uuid, text, text) is
  'Row-locked single-step requisition decision. Owner or manager only; requester can never decide their own document.';
comment on function public.convert_requisition_to_po(uuid, uuid) is
  'Idempotent, row-locked requisition fan-out with immutable purchase-UoM snapshots copied to PO lines. Documents only.';
