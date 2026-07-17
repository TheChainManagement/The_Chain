-- Wave 2 fast-follow: versioned RFQ re-awards (MG decision 2026-07-15).
--
-- RFQ-sourced requisitions form an immutable version chain. Re-awarding an
-- open RFQ atomically supersedes its current requisition and creates the next
-- version from authoritative quote snapshots. Direct requisitions remain
-- unversioned documents (version 1, current) and are otherwise unchanged.

alter table public.requisitions
  add column award_version int not null default 1,
  add column supersedes_requisition_id uuid,
  add column is_current_version boolean not null default true;

alter table public.requisitions
  add constraint requisitions_award_version_check check (award_version > 0);

-- Preserve any pre-migration repeated awards as an ordered history. The most
-- recent row remains current and every earlier row points to its predecessor.
with ranked as (
  select tenant_id, id, source_rfq_id,
         row_number() over (
           partition by tenant_id, source_rfq_id order by created_at, id
         )::int as version_no,
         lag(id) over (
           partition by tenant_id, source_rfq_id order by created_at, id
         ) as supersedes_id,
         row_number() over (
           partition by tenant_id, source_rfq_id order by created_at desc, id desc
         ) = 1 as is_current
  from public.requisitions
  where source_rfq_id is not null
)
update public.requisitions r
set award_version = ranked.version_no,
    supersedes_requisition_id = ranked.supersedes_id,
    is_current_version = ranked.is_current
from ranked
where r.tenant_id = ranked.tenant_id and r.id = ranked.id;

alter table public.requisitions
  add constraint requisitions_supersedes_fkey
  foreign key (tenant_id, supersedes_requisition_id)
  references public.requisitions (tenant_id, id);

create unique index requisitions_rfq_award_version_key
  on public.requisitions (tenant_id, source_rfq_id, award_version)
  where source_rfq_id is not null;

create unique index requisitions_one_current_rfq_award_key
  on public.requisitions (tenant_id, source_rfq_id)
  where source_rfq_id is not null and is_current_version;

create index requisitions_supersedes_idx
  on public.requisitions (tenant_id, supersedes_requisition_id)
  where supersedes_requisition_id is not null;

-- Version metadata can only be written by the atomic award RPC. Superseded
-- documents cannot be changed through PostgREST, lifecycle RPCs, or line RPCs.
create or replace function public.enforce_requisition_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.jwt_tenant_id() is null then return new; end if;

  if new.source_rfq_id is null then
    if new.award_version <> 1 or new.supersedes_requisition_id is not null
       or not new.is_current_version then
      raise exception 'version_metadata_guarded';
    end if;
  elsif coalesce(current_setting('app.reaward_in_progress', true), '') <> 'on' then
    raise exception 'version_metadata_guarded';
  end if;
  return new;
end;
$$;

create trigger requisitions_enforce_insert
before insert on public.requisitions
for each row execute function public.enforce_requisition_insert();

create or replace function public.enforce_requisition_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.tenant_id <> old.tenant_id then raise exception 'tenant_immutable'; end if;
  if public.jwt_tenant_id() is null then return new; end if;
  if not old.is_current_version then raise exception 'requisition_superseded'; end if;

  if new.award_version is distinct from old.award_version
     or new.supersedes_requisition_id is distinct from old.supersedes_requisition_id
     or new.source_rfq_id is distinct from old.source_rfq_id then
    raise exception 'version_metadata_guarded';
  end if;
  if new.is_current_version is distinct from old.is_current_version then
    if not (old.is_current_version and not new.is_current_version
            and coalesce(current_setting('app.reaward_in_progress', true), '') = 'on') then
      raise exception 'version_metadata_guarded';
    end if;
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

create or replace function public.enforce_current_requisition_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_requisition uuid;
  v_current boolean;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    v_requisition := old.requisition_id;
  else
    v_tenant := new.tenant_id;
    v_requisition := new.requisition_id;
  end if;
  select is_current_version into v_current
  from public.requisitions
  where tenant_id = v_tenant and id = v_requisition;
  if found and not v_current then raise exception 'requisition_superseded'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger requisition_lines_current_version
before insert or update or delete on public.requisition_lines
for each row execute function public.enforce_current_requisition_line();

-- Replace the award RPC with the versioned contract. A converted award cannot
-- be superseded because its purchase orders have already become durable facts.
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
  v_prior record;
  v_req uuid;
  v_total numeric;
  v_version int := 1;
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

  select id, status, award_version into v_prior
  from public.requisitions
  where tenant_id = p_tenant and source_rfq_id = p_rfq and is_current_version
  for update;
  if found then
    if v_prior.status = 'converted' then raise exception 'converted_award_cannot_be_superseded'; end if;
    v_version := v_prior.award_version + 1;
  end if;

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
    greatest(l.qty / coalesce(q.purchase_to_stock_factor, 1), coalesce(q.moq, 0))
    * q.quoted_unit_cost
  ), 2) into v_total
  from picks p
  join public.rfq_lines l
    on l.tenant_id = p_tenant and l.rfq_id = p_rfq and l.line_no = p.line_no
  join public.rfq_vendor_quotes q
    on q.tenant_id = l.tenant_id and q.rfq_id = l.rfq_id
   and q.line_no = l.line_no and q.supplier_id = p.supplier_id;

  perform set_config('app.reaward_in_progress', 'on', true);
  if v_prior.id is not null then
    update public.requisitions set is_current_version = false
    where tenant_id = p_tenant and id = v_prior.id;
  end if;

  insert into public.requisitions
    (tenant_id, location_id, source_rfq_id, requested_by_user_id, total,
     award_version, supersedes_requisition_id, is_current_version)
  values (p_tenant, v_rfq.location_id, p_rfq, auth.uid(), v_total,
          v_version, v_prior.id, true)
  returning id into v_req;
  perform set_config('app.reaward_in_progress', 'off', true);

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
         greatest(l.qty / coalesce(q.purchase_to_stock_factor, 1), coalesce(q.moq, 0)),
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
  'Atomically create an immutable RFQ award version and supersede its predecessor. Documents only; zero balance writes.';

-- Explicit lifecycle checks give callers a stable error before the header
-- trigger and preserve the existing approval and conversion contracts.
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

  select id, status, requested_by_user_id, is_current_version into v_req
  from public.requisitions
  where tenant_id = p_tenant and id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;
  if v_req.status <> 'submitted' then raise exception 'not_submitted'; end if;
  if v_actor is null or v_req.requested_by_user_id is null or v_actor = v_req.requested_by_user_id then
    raise exception 'self_approval_forbidden';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_rejection_note, '')), '') is null then
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

-- Add the current-version guard to the existing idempotent PO fan-out RPC.
-- The remainder intentionally matches the hardened W2-3 implementation.
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
  select id, status, location_id, is_current_version into v_req
  from public.requisitions
  where tenant_id = p_tenant and id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;

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
