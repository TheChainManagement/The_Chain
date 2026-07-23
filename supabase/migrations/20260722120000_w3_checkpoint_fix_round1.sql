-- The Chain - W3 checkpoint fix rounds 1 through 4.
-- B1 requester binding, B2 PO approval evidence, B3 lifecycle whitelist,
-- B4 current-role execution checks, and B5 invoker restoration.
-- Documents remain zero-balance writers. Inventory changes stay in the
-- established posting-kernel functions.
-- This file is amended in place because it has never been applied to prod or
-- merged to main.

-- B4: service-role callers must prove the explicit actor still has the
-- capability in tenant_members. This deliberately ignores the JWT role claim.
create or replace function public.member_can_execute(
  p_tenant uuid,
  p_user uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.tenant_id = p_tenant
      and m.user_id = p_user
      and case p_capability
        when 'inventory.move' then m.role in ('owner', 'manager', 'warehouse')
        when 'reorder.recompute' then m.role in ('owner', 'manager')
        when 'purchase_order.create' then m.role in ('owner', 'manager', 'planner')
        else false
      end
  );
$$;

revoke all on function public.member_can_execute(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.member_can_execute(uuid, uuid, text) to service_role;

comment on function public.member_can_execute(uuid, uuid, text) is
  'Current-database role gate for privileged service-role write paths. Never trusts a JWT role claim.';

-- Every storeroom balance RPC claims an inventory_op_events row before it
-- posts. Gate that shared seam using its explicit actor.
create or replace function public.enforce_inventory_operator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('issue', 'adjustment', 'hold', 'cycle_count_close')
     and not public.member_can_execute(new.tenant_id, new.actor_user_id, 'inventory.move') then
    raise exception 'inventory_operation_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_op_events_current_role on public.inventory_op_events;
create trigger inventory_op_events_current_role
before insert on public.inventory_op_events
for each row execute function public.enforce_inventory_operator_role();

revoke execute on function public.enforce_inventory_operator_role()
  from public, anon, authenticated, service_role;

-- Transfers do not use inventory_op_events, so enforce the same live role at
-- their event seam. The RPC still owns the paired posting transaction.
create or replace function public.enforce_transfer_operator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.member_can_execute(new.tenant_id, new.actor_user_id, 'inventory.move') then
    raise exception 'inventory_operation_forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_transfer_events_current_role on public.stock_transfer_events;
create trigger stock_transfer_events_current_role
before insert on public.stock_transfer_events
for each row execute function public.enforce_transfer_operator_role();

revoke execute on function public.enforce_transfer_operator_role()
  from public, anon, authenticated, service_role;

-- B1: authenticated inserts must name the caller as requester.
create or replace function public.enforce_requisition_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.jwt_tenant_id() is null then return new; end if;
  if new.requested_by_user_id is distinct from auth.uid() then
    raise exception 'requester_must_be_caller';
  end if;
  if new.status <> 'draft' then raise exception 'submission_rpc_required'; end if;

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
  if auth.uid() is null or p_actor is distinct from auth.uid() then
    raise exception 'actor_must_be_caller';
  end if;
  if public.jwt_tenant_id() is distinct from p_tenant or not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = p_actor
  ) then
    raise exception 'requisition_creation_forbidden';
  end if;
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

-- B3: whitelist every status edge. Only the conversion RPC may take an
-- approved requisition to converted. Returning a rejected request to draft
-- starts a clean decision cycle.
create or replace function public.enforce_requisition_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_policy_transition boolean :=
    coalesce(current_setting('app.requisition_policy_transition', true), '') = 'on';
  v_human_transition boolean :=
    coalesce(current_setting('app.requisition_decision_in_progress', true), '') = 'on';
  v_conversion boolean :=
    coalesce(current_setting('app.requisition_conversion_in_progress', true), '') = 'on';
  v_returning_to_draft boolean := old.status <> 'draft' and new.status = 'draft';
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
  if old.status not in ('draft', 'rejected') and new.total is distinct from old.total then
    raise exception 'submitted_total_immutable';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'submitted' then
      if old.status not in ('draft', 'rejected') then raise exception 'bad_requisition_transition'; end if;
      if not v_policy_transition then raise exception 'submission_rpc_required'; end if;
    elsif new.status = 'approved' and v_policy_transition then
      if old.status not in ('draft', 'rejected') then raise exception 'bad_requisition_transition'; end if;
      if new.approved_by_user_id is not null or new.decided_at is null then
        raise exception 'system_decision_metadata_invalid';
      end if;
      if new.approval_reason not in ('within_requester_limit', 'unlimited_requester_authority')
         or new.approval_policy_snapshot is null then
        raise exception 'system_decision_evidence_required';
      end if;
    elsif new.status in ('approved', 'rejected') then
      if not v_human_transition then raise exception 'decision_rpc_required'; end if;
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
    elsif new.status = 'converted' then
      if old.status <> 'approved' then raise exception 'bad_requisition_transition'; end if;
      if not v_conversion then raise exception 'conversion_rpc_required'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'rejected' then raise exception 'bad_requisition_transition'; end if;
    elsif new.status = 'canceled' then
      if old.status not in ('draft', 'submitted', 'rejected') then
        raise exception 'bad_requisition_transition';
      end if;
    else
      raise exception 'bad_requisition_transition';
    end if;
  end if;

  if v_returning_to_draft then
    new.approved_by_user_id := null;
    new.decided_at := null;
    new.rejection_note := null;
    new.approval_reason := null;
    new.approval_policy_snapshot := null;
  elsif (
    new.approved_by_user_id is distinct from old.approved_by_user_id
    or new.decided_at is distinct from old.decided_at
    or new.rejection_note is distinct from old.rejection_note
  ) and not v_policy_transition and not v_human_transition then
    raise exception 'decision_metadata_guarded';
  end if;

  if (new.approval_reason is distinct from old.approval_reason
      or new.approval_policy_snapshot is distinct from old.approval_policy_snapshot)
     and not v_policy_transition and not v_returning_to_draft then
    raise exception 'approval_evidence_guarded';
  end if;
  return new;
end;
$$;

-- B5 round-2 hardening: INVOKER RPCs cannot take explicit row locks on
-- authority tables that authenticated may only SELECT. This narrow definer
-- helper pins the JWT tenant, enforces self-or-privileged visibility, and owns
-- the membership + authority FOR SHARE lock.
create or replace function public.lock_member_requisition_authority(
  p_tenant uuid,
  p_user uuid
)
returns table (
  out_role public.member_role,
  out_requester_mode public.requisition_requester_mode,
  out_requester_limit numeric,
  out_approver_limit numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
begin
  if v_actor is null or p_tenant is distinct from public.jwt_tenant_id() then
    raise exception 'authority_read_forbidden';
  end if;

  select m.role into v_actor_role
  from public.tenant_members m
  where m.tenant_id = p_tenant and m.user_id = v_actor;
  if not found then raise exception 'authority_read_forbidden'; end if;
  if p_user is distinct from v_actor and v_actor_role not in ('owner', 'manager') then
    raise exception 'authority_read_forbidden';
  end if;

  return query
  select m.role, a.requester_mode, a.requester_limit, a.approver_limit
  from public.tenant_members m
  join public.tenant_member_requisition_authority a
    on a.tenant_id = m.tenant_id and a.user_id = m.user_id
  where m.tenant_id = p_tenant and m.user_id = p_user
  for share of m, a;
end;
$$;

revoke all on function public.lock_member_requisition_authority(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.lock_member_requisition_authority(uuid, uuid) to authenticated;

comment on function public.lock_member_requisition_authority(uuid, uuid) is
  'JWT-tenant-pinned membership and requisition-authority read with a FOR SHARE lock for authenticated INVOKER workflows.';

create or replace function public.submit_requisition(
  p_tenant uuid,
  p_requisition uuid
)
returns table (out_status text, out_reason text, out_auto_approved boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_req record;
  v_requester_role public.member_role;
  v_mode public.requisition_requester_mode := 'always_require_approval';
  v_limit numeric;
  v_total numeric;
  v_reason text;
  v_auto boolean := false;
  v_snapshot jsonb;
begin
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'submission_forbidden';
  end if;

  select a.out_role into v_actor_role
  from public.lock_member_requisition_authority(p_tenant, v_actor) a;
  if not found or v_actor_role not in ('owner', 'manager', 'planner') then
    raise exception 'submission_forbidden';
  end if;

  select r.id, r.status, r.location_id, r.requested_by_user_id,
         r.award_version, r.is_current_version
  into v_req
  from public.requisitions r
  where r.tenant_id = p_tenant and r.id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not public.can_access_location(v_req.location_id) then
    raise exception 'location_access_forbidden';
  end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;
  if v_req.status not in ('draft', 'rejected') then raise exception 'not_submittable'; end if;
  if v_req.requested_by_user_id is null then raise exception 'requester_required'; end if;

  select a.out_role, a.out_requester_mode, a.out_requester_limit
  into v_requester_role, v_mode, v_limit
  from public.lock_member_requisition_authority(p_tenant, v_req.requested_by_user_id) a;
  if not found then raise exception 'requester_not_member'; end if;

  perform 1 from public.requisition_lines rl
  where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
  for update;
  if not found or exists (
    select 1 from public.requisition_lines rl
    where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition
      and rl.unit_cost is null
  ) then raise exception 'costed_lines_required'; end if;

  select round(sum(rl.qty * rl.unit_cost), 2) into v_total
  from public.requisition_lines rl
  where rl.tenant_id = p_tenant and rl.requisition_id = p_requisition;
  if v_total is null then raise exception 'costed_lines_required'; end if;

  if v_mode = 'auto_approve_unlimited' then
    v_auto := true;
    v_reason := 'unlimited_requester_authority';
  elsif v_mode = 'auto_approve_to_limit' and v_total <= v_limit then
    v_auto := true;
    v_reason := 'within_requester_limit';
  elsif v_mode = 'auto_approve_to_limit' then
    v_reason := 'requester_limit_exceeded';
  else
    v_reason := 'approval_required_by_policy';
  end if;

  v_snapshot := jsonb_build_object(
    'decision_actor', 'system',
    'requester_user_id', v_req.requested_by_user_id,
    'requester_role', v_requester_role,
    'requester_mode', v_mode,
    'requester_limit', v_limit,
    'evaluated_total', v_total,
    'award_version', v_req.award_version,
    'evaluated_at', now()
  );

  perform set_config('app.requisition_policy_transition', 'on', true);
  update public.requisitions r
  set status = case when v_auto then 'approved' else 'submitted' end::public.requisition_status,
      total = v_total,
      approved_by_user_id = null,
      decided_at = case when v_auto then now() else null end,
      rejection_note = null,
      approval_reason = v_reason,
      approval_policy_snapshot = v_snapshot
  where r.tenant_id = p_tenant and r.id = p_requisition;
  perform set_config('app.requisition_policy_transition', 'off', true);

  return query select case when v_auto then 'approved' else 'submitted' end, v_reason, v_auto;
end;
$$;

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
  v_actor_role public.member_role;
  v_approver_limit numeric;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'bad_decision'; end if;
  if v_actor is null or public.jwt_tenant_id() is distinct from p_tenant then
    raise exception 'approval_forbidden';
  end if;

  select a.out_role, a.out_approver_limit
  into v_actor_role, v_approver_limit
  from public.lock_member_requisition_authority(p_tenant, v_actor) a;
  if not found or v_actor_role not in ('owner', 'manager') then
    raise exception 'approval_forbidden';
  end if;

  select r.id, r.status, r.location_id, r.total, r.requested_by_user_id, r.is_current_version
  into v_req
  from public.requisitions r
  where r.tenant_id = p_tenant and r.id = p_requisition
  for update;
  if not found then raise exception 'requisition_not_found'; end if;
  if not public.can_access_location(v_req.location_id) then raise exception 'location_access_forbidden'; end if;
  if not v_req.is_current_version then raise exception 'requisition_superseded'; end if;
  if v_req.status <> 'submitted' then raise exception 'not_submitted'; end if;
  if v_req.requested_by_user_id is null or v_actor = v_req.requested_by_user_id then
    raise exception 'self_approval_forbidden';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_rejection_note, '')), '') is null then
    raise exception 'rejection_note_required';
  end if;

  if p_decision = 'approved'
     and v_approver_limit is not null
     and coalesce(v_req.total, 0) > v_approver_limit then
    raise exception 'approval_over_authority';
  end if;

  perform set_config('app.requisition_decision_in_progress', 'on', true);
  update public.requisitions
  set status = p_decision::public.requisition_status,
      approved_by_user_id = v_actor,
      decided_at = now(),
      rejection_note = case when p_decision = 'rejected' then btrim(p_rejection_note) else null end
  where tenant_id = p_tenant and id = p_requisition;
  perform set_config('app.requisition_decision_in_progress', 'off', true);
  return query select p_decision;
end;
$$;

revoke all on function public.submit_requisition(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_requisition(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_requisition(uuid, uuid) to authenticated;
grant execute on function public.decide_requisition(uuid, uuid, text, text) to authenticated;

-- The current conversion implementation needs a one-shot lifecycle token for
-- the approved -> converted edge introduced above.
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

  perform set_config('app.requisition_conversion_in_progress', 'on', true);
  update public.requisitions set status = 'converted', updated_at = now()
  where tenant_id = p_tenant and id = p_requisition;
  perform set_config('app.requisition_conversion_in_progress', 'off', true);
end;
$$;

-- R2-F3 Option A: reorder recommendations enter the same requisition spend
-- spine as every other user-requested purchase. The authenticated converter is
-- the requester. Submission evaluates current authority in the same
-- transaction; only auto-approved requests immediately fan out to a PO.
alter table public.reorder_recommendations
  add column requisition_id uuid;

alter table public.reorder_recommendations
  add constraint reorder_recommendations_requisition_id_fkey
  foreign key (tenant_id, requisition_id)
  references public.requisitions (tenant_id, id) on delete set null (requisition_id);

create index reorder_recommendations_requisition_idx
  on public.reorder_recommendations (tenant_id, requisition_id)
  where requisition_id is not null;

drop function public.convert_recommendations_to_po(uuid, uuid[]);

create function public.convert_recommendations_to_requisition(
  p_tenant uuid,
  p_recommendation_ids uuid[]
)
returns table (
  out_requisition_id uuid,
  out_approval_status text,
  out_approval_reason text,
  out_auto_approved boolean,
  out_po_id uuid,
  out_line_count int
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.member_role;
  v_supplier uuid;
  v_location uuid;
  v_open int;
  v_distinct_supplier int;
  v_distinct_location int;
  v_null_supplier int;
  v_req uuid;
  v_line_no int := 0;
  v_total numeric := 0;
  v_submit record;
  v_po uuid;
  v_po_lines int;
  r record;
  v_cost numeric;
  v_purchase_uom text;
  v_factor numeric;
  v_ordered numeric;
begin
  if v_actor is null or p_tenant is distinct from public.jwt_tenant_id() then
    raise exception 'reorder_conversion_forbidden';
  end if;
  select a.out_role into v_actor_role
  from public.lock_member_requisition_authority(p_tenant, v_actor) a;
  if not found or v_actor_role not in ('owner', 'manager', 'planner') then
    raise exception 'reorder_conversion_forbidden';
  end if;
  if p_recommendation_ids is null or coalesce(array_length(p_recommendation_ids, 1), 0) = 0 then
    raise exception 'no_recommendations';
  end if;

  perform 1 from public.reorder_recommendations rr
  where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids)
  for update;

  select count(*) filter (where rr.status = 'open'),
         count(distinct rr.supplier_id),
         count(*) filter (where rr.supplier_id is null),
         count(distinct rr.location_id)
  into v_open, v_distinct_supplier, v_null_supplier, v_distinct_location
  from public.reorder_recommendations rr
  where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids);

  if v_open = 0 then raise exception 'no_recommendations'; end if;
  if v_open <> array_length(p_recommendation_ids, 1) then raise exception 'not_open'; end if;
  if v_distinct_supplier = 0 or v_null_supplier > 0 then raise exception 'no_supplier'; end if;
  if v_distinct_supplier <> 1 then raise exception 'mixed_supplier'; end if;
  if v_distinct_location <> 1 then raise exception 'mixed_location'; end if;

  select rr.supplier_id, rr.location_id into v_supplier, v_location
  from public.reorder_recommendations rr
  where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids)
  limit 1;
  if not public.can_access_location(v_location) then raise exception 'location_access_forbidden'; end if;

  for r in
    select rr.id, rr.product_id, rr.recommended_qty
    from public.reorder_recommendations rr
    where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids)
    order by rr.product_id
  loop
    select ps.unit_cost,
           nullif(btrim(ps.purchase_uom), ''),
           case
             when nullif(btrim(ps.purchase_uom), '') is null then null
             else coalesce(ps.purchase_to_stock_factor, 1)
           end
    into v_cost, v_purchase_uom, v_factor
    from public.product_suppliers ps
    where ps.tenant_id = p_tenant
      and ps.product_id = r.product_id
      and ps.supplier_id = v_supplier
    limit 1;
    if not found or v_cost is null then raise exception 'costed_lines_required'; end if;
    v_ordered := r.recommended_qty / coalesce(v_factor, 1);
    v_total := v_total + v_ordered * v_cost;
  end loop;

  insert into public.requisitions
    (tenant_id, location_id, source_rfq_id, requested_by_user_id, total)
  values (p_tenant, v_location, null, v_actor, round(v_total, 2))
  returning id into v_req;

  for r in
    select rr.id, rr.product_id, rr.recommended_qty
    from public.reorder_recommendations rr
    where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids)
    order by rr.product_id
  loop
    v_line_no := v_line_no + 1;
    select ps.unit_cost,
           nullif(btrim(ps.purchase_uom), ''),
           case
             when nullif(btrim(ps.purchase_uom), '') is null then null
             else coalesce(ps.purchase_to_stock_factor, 1)
           end
    into v_cost, v_purchase_uom, v_factor
    from public.product_suppliers ps
    where ps.tenant_id = p_tenant
      and ps.product_id = r.product_id
      and ps.supplier_id = v_supplier
    limit 1;
    v_ordered := r.recommended_qty / coalesce(v_factor, 1);

    insert into public.requisition_lines
      (tenant_id, requisition_id, line_no, product_id, supplier_id, qty, unit_cost,
       purchase_uom, purchase_to_stock_factor)
    values
      (p_tenant, v_req, v_line_no, r.product_id, v_supplier, v_ordered, v_cost,
       v_purchase_uom, v_factor);
  end loop;

  update public.reorder_recommendations rr
  set status = 'converted', requisition_id = v_req, updated_at = now()
  where rr.tenant_id = p_tenant and rr.id = any(p_recommendation_ids);

  select s.out_status, s.out_reason, s.out_auto_approved
  into v_submit
  from public.submit_requisition(p_tenant, v_req) s;

  if v_submit.out_auto_approved then
    select c.out_po_id, c.out_line_count into v_po, v_po_lines
    from public.convert_requisition_to_po(p_tenant, v_req) c;
  end if;

  return query select
    v_req,
    v_submit.out_status,
    v_submit.out_reason,
    v_submit.out_auto_approved,
    v_po,
    coalesce(v_po_lines, v_line_no);
end;
$$;

revoke all on function public.convert_recommendations_to_requisition(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.convert_recommendations_to_requisition(uuid, uuid[])
  to authenticated;

comment on function public.convert_recommendations_to_requisition(uuid, uuid[]) is
  'Atomically converts same-supplier/location recommendations into a submitted requisition under the converter authority policy; only auto-approved requests immediately create a linked PO.';

-- B2 chosen contract: a PO can commit in-transit only when it came from an
-- approved, current requisition. Conversion changes
-- the requisition status to converted, so immutable decision evidence is the
-- durable approval proof. This applies equally to authenticated and privileged
-- callers so a service-role application path cannot bypass spend control.
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
  select id, status, location_id, supplier_id, requisition_id into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if v_po.status not in ('draft', 'recommended') then
    return query select v_po.status::text, false;
    return;
  end if;

  if not exists (
    select 1
    from public.requisitions r
    where r.tenant_id = p_tenant
      and r.id = v_po.requisition_id
      and r.is_current_version
      and r.status = 'converted'
      and r.decided_at is not null
      and (
        r.approved_by_user_id is not null
        or (
          r.approved_by_user_id is null
          and r.approval_reason in ('within_requester_limit', 'unlimited_requester_authority')
          and r.approval_policy_snapshot is not null
        )
      )
  ) then
    raise exception 'approved_requisition_required';
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

comment on function public.apply_po_approval(uuid, uuid, text, text, text, int) is
  'Commits a PO to in_transit only with a current converted requisition carrying human or system approval evidence.';

-- Low-cost review cleanups.
drop policy if exists tenant_member_requisition_authority_select
  on public.tenant_member_requisition_authority;
create policy tenant_member_requisition_authority_select
on public.tenant_member_requisition_authority for select using (
  tenant_id = public.jwt_tenant_id()
  and (
    user_id = auth.uid()
    or exists (
      select 1 from public.tenant_members m
      where m.tenant_id = tenant_member_requisition_authority.tenant_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'manager')
    )
  )
);

alter function public.set_primary_location(uuid, uuid) set search_path = '';

drop policy if exists stock_transfer_events_select on public.stock_transfer_events;
create policy stock_transfer_events_select on public.stock_transfer_events for select using (
  tenant_id = public.jwt_tenant_id()
  and (
    public.can_access_location(source_location_id)
    or public.can_access_location(destination_location_id)
  )
);
