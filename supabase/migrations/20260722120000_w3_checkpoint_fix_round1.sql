-- The Chain - W3 checkpoint fix round 1.
-- B1 requester binding, B2 PO approval evidence, B3 lifecycle whitelist,
-- B4 current-role execution checks, and B5 invoker restoration.
-- Documents remain zero-balance writers. Inventory changes stay in the
-- established posting-kernel functions.

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
  elsif new.approved_by_user_id is distinct from old.approved_by_user_id
     or new.decided_at is distinct from old.decided_at then
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

-- B5: restore SECURITY INVOKER while retaining the live membership, tenant,
-- location, policy, and role checks inside each function.
alter function public.submit_requisition(uuid, uuid) security invoker;
alter function public.decide_requisition(uuid, uuid, text, text) security invoker;

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
