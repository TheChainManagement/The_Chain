-- ============================================================
-- W2-2b — storeroom operations (kickoff Item 1)
-- ============================================================
-- The W2-2 migration per docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md §10, plus the
-- three operator posting RPCs (issue, adjustment, cycle-count close) in the
-- Block 11b receive_purchase_order style: SECURITY INVOKER, service-role
-- caller, action gate authorizes, idempotency-ledger claim first, movements +
-- inventory_levels move together atomically. These are the posting-kernel
-- prototypes Item 2d later unifies behind one service.
--
-- MG-locked decisions (kickoff Status, 2026-07-07):
--   * demand_ref_type is user-picked: work_order | crew | cost_center
--   * issue form carries reason_code + note → note column added here
--   * who can issue = owner/manager/warehouse (enforced at the action gate;
--     RPCs run as system like every other movement writer)

-- ----- stock_movements: the §10 column set + note -----
-- ALTERs on the partitioned parent cascade to every partition.
alter table stock_movements
  add column if not exists demand_ref_type text,
  add column if not exists demand_ref_id text,
  add column if not exists reason_code text,
  add column if not exists note text;

-- ----- locations.location_kind -----
-- 'stockroom' now; later van | job_site | cabinet | wip | quarantine. Open set
-- by design (no CHECK) so mobile/site kinds arrive without a migration.
alter table locations add column if not exists location_kind text;

-- ----- validation CHECKs (spec §10 + the enum-audit return types) -----
-- The demand-ref envelope is meaningful only with a ref id; the type list is
-- MG's locked set. Existing rows (all pre-issue types) pass trivially.
alter table stock_movements add constraint stock_movements_demand_ref_type_check
  check (demand_ref_type is null
         or demand_ref_type in ('work_order', 'crew', 'cost_center'));

alter table stock_movements add constraint stock_movements_issue_out_check
  check (type <> 'issue_out'
         or (demand_ref_type is not null and demand_ref_id is not null and quantity < 0));

alter table stock_movements add constraint stock_movements_issue_return_check
  check (type <> 'issue_return'
         or (demand_ref_type is not null and demand_ref_id is not null and quantity > 0));

-- Return vocabulary shipped with signs enforced now, UI later (kickoff Item 1):
-- stock leaves on a vendor return, re-enters on a customer return.
alter table stock_movements add constraint stock_movements_return_to_vendor_check
  check (type <> 'return_to_vendor' or quantity < 0);

alter table stock_movements add constraint stock_movements_customer_return_check
  check (type <> 'customer_return' or quantity > 0);

-- "Issues by consuming object" is the storeroom's task-facing read (what did
-- WO-10482 consume). Partial: the index only carries ref-tagged rows.
create index if not exists stock_movements_demand_ref_idx
  on stock_movements (tenant_id, demand_ref_type, demand_ref_id, occurred_at)
  where demand_ref_id is not null;

-- ----- operator-movement idempotency ledger -----
-- Mirrors po_receipt_events: one row per APPLIED operator posting (issue,
-- adjustment, cycle-count close), unique on (tenant, key) so a re-click or
-- retried request replays as a no-op. Named to stay clear of the deferred
-- header/line split's reserved names (stock_movement_events/_lines, §10).
create table inventory_op_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('issue', 'adjustment', 'cycle_count_close')),
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  summary jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

alter table inventory_op_events enable row level security;

-- Member-readable within the tenant (operator history is operator-facing);
-- writes go through the service-role RPCs, so no member write policy.
create policy inventory_op_events_select on inventory_op_events
  for select using (tenant_id = jwt_tenant_id());

-- Every tenant-scoped table carries the audit dispatcher; tables created after
-- the 5J hardening loop attach their own.
create trigger audit_inventory_op_events
  after insert or update or delete on inventory_op_events
  for each row execute function capture_audit();

-- ============================================================
-- RPC 1 — post_issue_movements: issue out / issue return
-- ============================================================
-- One consuming object per event (the demand ref); one or many lines (a kit of
-- 8 parts = 8 rows sharing the ref, per the §10 no-header decision). Quantities
-- arrive POSITIVE; the RPC applies the sign for the movement type. on_hand may
-- go negative on an issue: the part physically left even if the system thought
-- there were fewer — cycle counts reconcile drift, they don't block work.

create or replace function post_issue_movements(
  p_tenant uuid,
  p_location uuid,
  p_movement text,           -- 'issue_out' | 'issue_return'
  p_demand_ref_type text,    -- 'work_order' | 'crew' | 'cost_center'
  p_demand_ref_id text,
  p_reason_code text,
  p_note text,
  p_lines jsonb,             -- [{"product_id": uuid, "qty": numeric > 0}, ...]
  p_actor uuid,
  p_idempotency_key text
)
returns table (out_applied bool, out_lines int, out_total_qty numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line record;
  v_qty numeric;
  v_signed numeric;
  v_count int := 0;
  v_total numeric := 0;
begin
  if p_movement not in ('issue_out', 'issue_return') then
    raise exception 'bad_movement';
  end if;
  if p_demand_ref_type is null
     or p_demand_ref_type not in ('work_order', 'crew', 'cost_center') then
    raise exception 'bad_demand_ref_type';
  end if;
  if p_demand_ref_id is null or btrim(p_demand_ref_id) = '' then
    raise exception 'missing_demand_ref';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines';
  end if;

  -- Idempotency claim FIRST: a replayed key changes nothing.
  insert into public.inventory_op_events
    (tenant_id, kind, actor_user_id, idempotency_key)
  values (p_tenant, 'issue', p_actor, p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select false, 0, 0::numeric;
    return;
  end if;

  for v_line in
    select (elem ->> 'product_id')::uuid as product_id,
           (elem ->> 'qty')::numeric as qty
    from jsonb_array_elements(p_lines) elem
  loop
    v_qty := coalesce(v_line.qty, 0);
    if v_qty <= 0 then raise exception 'bad_qty'; end if;
    v_signed := case when p_movement = 'issue_out' then -v_qty else v_qty end;

    insert into public.stock_movements
      (tenant_id, product_id, location_id, type, quantity, source, source_ref,
       occurred_at, demand_ref_type, demand_ref_id, reason_code, note)
    values
      (p_tenant, v_line.product_id, p_location,
       p_movement::public.stock_movement_type, v_signed, 'manual',
       'issue:key=' || p_idempotency_key || ':product=' || v_line.product_id::text,
       now(), p_demand_ref_type, btrim(p_demand_ref_id),
       nullif(btrim(coalesce(p_reason_code, '')), ''),
       nullif(btrim(coalesce(p_note, '')), ''));

    insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
    values (p_tenant, v_line.product_id, p_location, v_signed)
    on conflict (tenant_id, product_id, location_id)
      do update set on_hand = public.inventory_levels.on_hand + excluded.on_hand;

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  end loop;

  update public.inventory_op_events
    set summary = jsonb_build_object(
      'movement', p_movement, 'lines', v_count, 'total_qty', v_total,
      'demand_ref_type', p_demand_ref_type, 'demand_ref_id', btrim(p_demand_ref_id))
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  return query select true, v_count, v_total;
end;
$$;

comment on function post_issue_movements(uuid, uuid, text, text, text, text, text, jsonb, uuid, text) is
  'Storeroom issue (W2-2): posts issue_out / issue_return movements tagged to '
  'one consuming object (work_order | crew | cost_center) and moves on_hand, '
  'atomically, idempotent on p_idempotency_key. Quantities arrive positive; '
  'the sign follows the movement type. A kit = N rows sharing the demand ref.';

-- ============================================================
-- RPC 2 — post_stock_adjustment: manual signed correction
-- ============================================================

create or replace function post_stock_adjustment(
  p_tenant uuid,
  p_location uuid,
  p_product uuid,
  p_delta numeric,           -- signed; the correction applied to on_hand
  p_reason_code text,
  p_note text,
  p_actor uuid,
  p_idempotency_key text
)
returns table (out_applied bool, out_on_hand numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_on_hand numeric;
begin
  if p_delta is null or p_delta = 0 then raise exception 'bad_qty'; end if;
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'missing_reason';
  end if;

  insert into public.inventory_op_events
    (tenant_id, kind, actor_user_id, idempotency_key)
  values (p_tenant, 'adjustment', p_actor, p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select false, null::numeric;
    return;
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, location_id, type, quantity, source, source_ref,
     occurred_at, reason_code, note)
  values
    (p_tenant, p_product, p_location, 'adjustment', p_delta, 'manual',
     'adjust:key=' || p_idempotency_key, now(), btrim(p_reason_code),
     nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
  values (p_tenant, p_product, p_location, p_delta)
  on conflict (tenant_id, product_id, location_id)
    do update set on_hand = public.inventory_levels.on_hand + excluded.on_hand
  returning on_hand into v_on_hand;

  update public.inventory_op_events
    set summary = jsonb_build_object(
      'product_id', p_product, 'delta', p_delta, 'reason_code', btrim(p_reason_code))
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  return query select true, v_on_hand;
end;
$$;

comment on function post_stock_adjustment(uuid, uuid, uuid, numeric, text, text, uuid, text) is
  'Manual stock adjustment (W2-2): one signed correction movement + on_hand '
  'update, atomically, idempotent on p_idempotency_key. Reason code required.';

-- ============================================================
-- RPC 3 — close_cycle_count_session: variance posts to the ledger
-- ============================================================
-- Closes the variance-reconciliation gap (kickoff Item 1 + the wired-for
-- acceptance test in SYSTEM_DESIGN.md): closing a session posts cycle_count
-- movements and sets on_hand to the counted quantity. The delta is computed
-- against on_hand AT CLOSE under the level row lock (not the entry-time
-- expected_qty snapshot), so stock that moved mid-count reconciles to what was
-- actually counted; expected_qty stays what the variance REPORT compares to.

create or replace function close_cycle_count_session(
  p_tenant uuid,
  p_session uuid,
  p_actor uuid,
  p_idempotency_key text
)
returns table (out_applied bool, out_lines int, out_movements int, out_abs_variance numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session record;
  v_line record;
  v_on_hand numeric;
  v_delta numeric;
  v_lines int := 0;
  v_moves int := 0;
  v_abs numeric := 0;
begin
  select id, location_id, status into v_session
  from public.cycle_count_sessions
  where tenant_id = p_tenant and id = p_session
  for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_session.status not in ('open', 'in_progress') then
    raise exception 'session_terminal';
  end if;

  insert into public.inventory_op_events
    (tenant_id, kind, actor_user_id, idempotency_key)
  values (p_tenant, 'cycle_count_close', p_actor, p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select false, 0, 0, 0::numeric;
    return;
  end if;

  for v_line in
    select product_id, expected_qty, counted_qty
    from public.cycle_count_lines
    where tenant_id = p_tenant and session_id = p_session
      and counted_qty is not null
  loop
    v_lines := v_lines + 1;

    -- Lock (or create) the level row, then reconcile to the counted quantity.
    insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
    values (p_tenant, v_line.product_id, v_session.location_id, 0)
    on conflict (tenant_id, product_id, location_id) do nothing;

    select on_hand into v_on_hand
    from public.inventory_levels
    where tenant_id = p_tenant and product_id = v_line.product_id
      and location_id = v_session.location_id
    for update;

    v_delta := v_line.counted_qty - v_on_hand;

    if v_delta <> 0 then
      insert into public.stock_movements
        (tenant_id, product_id, location_id, type, quantity, source, source_ref,
         occurred_at, reason_code)
      values
        (p_tenant, v_line.product_id, v_session.location_id, 'cycle_count',
         v_delta, 'manual',
         'count:session=' || p_session::text || ':product=' || v_line.product_id::text,
         now(), 'count_variance');
      v_moves := v_moves + 1;
      v_abs := v_abs + abs(v_delta);
    end if;

    update public.inventory_levels
      set on_hand = v_line.counted_qty, last_counted_at = now()
      where tenant_id = p_tenant and product_id = v_line.product_id
        and location_id = v_session.location_id;

    -- The REPORT variance compares against the entry-time expectation.
    update public.cycle_count_lines
      set variance = v_line.counted_qty - coalesce(v_line.expected_qty, 0),
          counted_at = coalesce(counted_at, now())
      where tenant_id = p_tenant and session_id = p_session
        and product_id = v_line.product_id;
  end loop;

  if v_lines = 0 then raise exception 'nothing_counted'; end if;

  update public.cycle_count_sessions
    set status = 'completed', completed_at = now()
    where tenant_id = p_tenant and id = p_session;

  update public.inventory_op_events
    set summary = jsonb_build_object(
      'session_id', p_session, 'lines', v_lines,
      'movements', v_moves, 'abs_variance', v_abs)
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  return query select true, v_lines, v_moves, v_abs;
end;
$$;

comment on function close_cycle_count_session(uuid, uuid, uuid, text) is
  'Cycle-count close (W2-2): reconciles each counted line to on_hand AT CLOSE '
  'under the level row lock, posts the delta as a cycle_count movement, stamps '
  'last_counted_at, records report variance vs expected_qty, completes the '
  'session. Idempotent on p_idempotency_key; re-close raises session_terminal.';
