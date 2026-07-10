-- ============================================================
-- W2-2.5b — inventory-core hardening (kickoff Item 2)
-- ============================================================
-- The anchor-point migration for the modular platform: UoM conversion (2a),
-- moving-average cost + valuation (2b), the stock-status/on-hold dimension
-- (2c), and the inventory POSTING KERNEL (2d) — one SQL function that every
-- balance mutation flows through from here on. W2-3 procurement, logistics,
-- and maintenance attach to stock ONLY through this kernel.
--
-- MG-locked decisions (kickoff Status, 2026-07-09):
--   * Fractional stock quantities ALLOWED on conversion remainders; the
--     receive UI flags remainders, nothing force-rounds.
--   * Held stock COUNTS in valuation (still owned) and is EXCLUDED from
--     reorder / available-to-promise position.
--   * Hold/release ships WITH UI this wave.
--
-- Explicitly deferred, per the kickoff doc (recorded so they are not lost):
-- FIFO cost layers, landed cost (freight/duty allocation), GL integration,
-- three-way match.

-- ============================================================
-- 2a — purchase-UoM support on the supplier link
-- ============================================================
-- `products.unit_of_measure` stays the canonical STOCK unit. The supplier link
-- gains the purchase unit + conversion factor (1 purchase unit = factor stock
-- units). Null factor means purchase unit = stock unit, factor 1. From this
-- migration on, `product_suppliers.unit_cost` and `purchase_order_lines`
-- (ordered_qty / received_qty / unit_cost) are in PURCHASE UoM when a factor is
-- set; the ledger and inventory_levels stay in stock UoM only, always.

alter table product_suppliers
  add column if not exists purchase_uom text,
  add column if not exists purchase_to_stock_factor numeric(14,4);

alter table product_suppliers add constraint product_suppliers_factor_positive_check
  check (purchase_to_stock_factor is null or purchase_to_stock_factor > 0);

-- ============================================================
-- 2b + 2c — level columns: moving-average cost, provenance, on-hold
-- ============================================================
-- avg_unit_cost is stock-UoM basis, 4 decimals (a per-case cost divided by a
-- factor of 12 must not lose cents). on_hold is a SUB-BUCKET of on_hand: held
-- goods are still on the shelf and still valued; they are just not available.

alter table inventory_levels
  add column if not exists avg_unit_cost numeric(14,4),
  add column if not exists avg_cost_provenance text,
  add column if not exists on_hold numeric(14,2) not null default 0;

alter table inventory_levels add constraint inventory_levels_avg_cost_provenance_check
  check (avg_cost_provenance is null or avg_cost_provenance in ('seeded', 'posted'));

alter table inventory_levels add constraint inventory_levels_on_hold_nonnegative_check
  check (on_hold >= 0);

-- hold/release ledger rows carry positive quantities (the amount moved into or
-- out of the held bucket); the sign convention lives in the TYPE.
alter table stock_movements add constraint stock_movements_hold_check
  check (type <> 'hold' or quantity > 0);

alter table stock_movements add constraint stock_movements_release_check
  check (type <> 'release' or quantity > 0);

-- The hold/release idempotency events join the operator ledger.
alter table inventory_op_events drop constraint inventory_op_events_kind_check;
alter table inventory_op_events add constraint inventory_op_events_kind_check
  check (kind in ('issue', 'adjustment', 'cycle_count_close', 'hold'));

-- ============================================================
-- 2d — THE POSTING KERNEL: post_stock_movement
-- ============================================================
-- One atomic primitive: validate the type contract, write the ledger row, move
-- the balance — under the level row lock so the moving-average math and the
-- hold-bucket math are race-safe. Every balance-affecting writer (receive,
-- issue, adjust, cycle-count close, hold/release, onboarding seed) calls THIS,
-- keeping its own orchestration (idempotency ledgers, status transitions)
-- outside. SECURITY INVOKER, service-role caller — same trust shape as every
-- movement writer since Block 11b.
--
-- Balance rules by type:
--   * hold      qty > 0 → on_hold += qty        (on_hand unchanged; guard:
--                cannot hold more than is currently un-held on the shelf)
--   * release   qty > 0 → on_hold -= qty        (guard: cannot release more
--                than is held)
--   * receipt   qty > 0 → on_hand += qty; when p_affects_in_transit,
--                in_transit -= qty (floored at 0). When p_unit_cost (stock-UoM
--                basis) rides in: moving average updates —
--                  on_hand <= 0 before → new_avg = p_unit_cost
--                  else new_avg = ((on_hand*old_avg)+(qty*cost))/(on_hand+qty)
--   * everything else → on_hand += qty (signed), avg cost untouched; existing
--     sign/ref CHECKs still apply (issue_out negative + demand ref, etc.).

create or replace function post_stock_movement(
  p_tenant uuid,
  p_product uuid,
  p_location uuid,
  p_type text,
  p_quantity numeric,
  p_source text,
  p_source_ref text,
  p_occurred_at timestamptz,
  p_demand_ref_type text default null,
  p_demand_ref_id text default null,
  p_reason_code text default null,
  p_note text default null,
  p_unit_cost numeric default null,
  p_affects_in_transit boolean default false
)
returns table (out_on_hand numeric, out_on_hold numeric, out_avg_unit_cost numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_level record;
  v_new_on_hand numeric;
  v_new_on_hold numeric;
  v_new_in_transit numeric;
  v_new_avg numeric;
  v_new_provenance text;
begin
  if p_quantity is null or p_quantity = 0 then raise exception 'bad_qty'; end if;

  if p_type in ('hold', 'release', 'receipt', 'issue_return', 'customer_return', 'transfer_in')
     and p_quantity < 0 then
    raise exception 'bad_sign';
  end if;
  if p_type in ('sale', 'issue_out', 'return_to_vendor', 'transfer_out')
     and p_quantity > 0 then
    raise exception 'bad_sign';
  end if;
  if p_type in ('issue_out', 'issue_return')
     and (p_demand_ref_type is null or p_demand_ref_id is null) then
    raise exception 'missing_demand_ref';
  end if;
  if p_type in ('hold', 'release')
     and (p_reason_code is null or btrim(p_reason_code) = '') then
    raise exception 'missing_reason';
  end if;

  -- Lock (or create) the level row: the avg-cost read-modify-write and the
  -- hold-bucket guards below are only correct under this lock.
  insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
  values (p_tenant, p_product, p_location, 0)
  on conflict (tenant_id, product_id, location_id) do nothing;

  select on_hand, on_hold, in_transit, avg_unit_cost, avg_cost_provenance
    into v_level
  from public.inventory_levels
  where tenant_id = p_tenant and product_id = p_product and location_id = p_location
  for update;

  v_new_on_hand := v_level.on_hand;
  v_new_on_hold := v_level.on_hold;
  v_new_in_transit := v_level.in_transit;
  v_new_avg := v_level.avg_unit_cost;
  v_new_provenance := v_level.avg_cost_provenance;

  if p_type = 'hold' then
    if p_quantity > (v_level.on_hand - v_level.on_hold) then
      raise exception 'insufficient_stock_to_hold';
    end if;
    v_new_on_hold := v_level.on_hold + p_quantity;
  elsif p_type = 'release' then
    if p_quantity > v_level.on_hold then
      raise exception 'insufficient_held';
    end if;
    v_new_on_hold := v_level.on_hold - p_quantity;
  else
    v_new_on_hand := v_level.on_hand + p_quantity;
    if p_type = 'receipt' and p_affects_in_transit then
      v_new_in_transit := greatest(0, v_level.in_transit - p_quantity);
    end if;
    if p_type = 'receipt' and p_unit_cost is not null then
      if v_level.on_hand <= 0 or v_level.avg_unit_cost is null then
        v_new_avg := p_unit_cost;
      else
        v_new_avg := ((v_level.on_hand * v_level.avg_unit_cost)
                      + (p_quantity * p_unit_cost))
                     / (v_level.on_hand + p_quantity);
      end if;
      v_new_provenance := 'posted';
    end if;
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, location_id, type, quantity, source, source_ref,
     occurred_at, demand_ref_type, demand_ref_id, reason_code, note)
  values
    (p_tenant, p_product, p_location, p_type::public.stock_movement_type,
     p_quantity, p_source::public.stock_movement_source, p_source_ref,
     p_occurred_at, p_demand_ref_type, p_demand_ref_id,
     nullif(btrim(coalesce(p_reason_code, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''));

  update public.inventory_levels
    set on_hand = v_new_on_hand,
        on_hold = v_new_on_hold,
        in_transit = v_new_in_transit,
        avg_unit_cost = v_new_avg,
        avg_cost_provenance = v_new_provenance
    where tenant_id = p_tenant and product_id = p_product and location_id = p_location;

  return query select v_new_on_hand, v_new_on_hold, v_new_avg;
end;
$$;

comment on function post_stock_movement(uuid, uuid, uuid, text, numeric, text, text, timestamptz, text, text, text, text, numeric, boolean) is
  'THE inventory posting kernel (W2-2.5): validates the type contract, writes '
  'the ledger row, and moves the balance atomically under the level row lock — '
  'including the moving-average cost update on costed receipts and the on_hold '
  'bucket on hold/release. Every balance mutation flows through here; future '
  'modules (W2-3 procurement, logistics, maintenance) touch stock ONLY via '
  'this function. Callers own orchestration (idempotency, status).';

-- ============================================================
-- 2d — record_stock_movements: the append-only ingestion entry
-- ============================================================
-- CSV import and QBO sync ingest HISTORICAL movements (demand history for the
-- forecaster). They deliberately do NOT move balances — the on-hand a tenant
-- imports or syncs already reflects that history, so replaying it into
-- inventory_levels would double-count. This set-based function is the kernel's
-- second door: same single entry point to the LEDGER, explicitly declared
-- balance-neutral, idempotent on the (tenant, source, source_ref, occurred_at)
-- natural key like the upserts it replaces.

create or replace function record_stock_movements(
  p_tenant uuid,
  p_rows jsonb
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'bad_rows';
  end if;

  insert into public.stock_movements
    (tenant_id, product_id, location_id, type, quantity, source, source_ref, occurred_at)
  select
    p_tenant,
    (elem ->> 'product_id')::uuid,
    (elem ->> 'location_id')::uuid,
    (elem ->> 'type')::public.stock_movement_type,
    (elem ->> 'quantity')::numeric,
    (elem ->> 'source')::public.stock_movement_source,
    elem ->> 'source_ref',
    (elem ->> 'occurred_at')::timestamptz
  from jsonb_array_elements(p_rows) elem
  on conflict (tenant_id, source, source_ref, occurred_at) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function record_stock_movements(uuid, jsonb) is
  'Kernel ingestion door (W2-2.5): set-based append of HISTORICAL movements '
  '(CSV import, QBO sync). Balance-neutral by design — imported history is '
  'already reflected in imported on-hand. Idempotent on the movement dedup '
  'key; returns the count actually inserted.';

-- ============================================================
-- 2a — receive_purchase_order v3: purchase-UoM receipt through the kernel
-- ============================================================
-- Same orchestration as Block 11b (idempotency ledger, clamp at ordered,
-- status advance, ONE supplier_performance row) — but the ledger write and the
-- balance move now go through post_stock_movement, converting purchase UoM to
-- stock UoM per line (stock qty = delta × factor; stock unit cost = line
-- unit_cost ÷ factor) and feeding the moving average. PO-line quantities and
-- supplier_performance stay in PURCHASE UoM (the unit the promise was made
-- in); the ledger and inventory_levels get stock UoM.

create or replace function receive_purchase_order(
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
  v_po record;
  v_line record;
  v_add numeric;
  v_next numeric;
  v_delta numeric;
  v_factor numeric;
  v_stock_qty numeric;
  v_stock_cost numeric;
  v_ordered numeric := 0;
  v_received numeric := 0;
  v_event numeric := 0;
  v_in_full bool;
  v_on_time bool;
  v_otif bool;
  v_status text;
begin
  select id, supplier_id, location_id, status, expected_delivery_at
    into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po
  for update;
  if not found then raise exception 'po_not_found'; end if;

  -- Idempotency gate FIRST, under the PO row lock (unchanged from Block 11b).
  insert into public.po_receipt_events (tenant_id, po_id, idempotency_key, event_qty)
  values (p_tenant, p_po, p_idempotency_key, 0)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select v_po.status::text, v_po.supplier_id, 0::numeric, false;
    return;
  end if;

  if v_po.status in ('received', 'closed', 'canceled') then
    raise exception 'po_terminal';
  end if;

  for v_line in
    select pol.line_no, pol.product_id, pol.ordered_qty, pol.received_qty, pol.unit_cost,
           ps.purchase_to_stock_factor
    from public.purchase_order_lines pol
    left join public.product_suppliers ps
      on ps.tenant_id = pol.tenant_id
     and ps.product_id = pol.product_id
     and ps.supplier_id = v_po.supplier_id
    where pol.tenant_id = p_tenant and pol.po_id = p_po
  loop
    v_add := coalesce((p_lines ->> v_line.line_no::text)::numeric, 0);
    if v_add < 0 then v_add := 0; end if;
    v_next := least(v_line.ordered_qty, v_line.received_qty + v_add);  -- clamp at ordered
    v_delta := v_next - v_line.received_qty;                          -- purchase-UoM delta
    v_ordered := v_ordered + v_line.ordered_qty;
    v_received := v_received + v_next;
    v_event := v_event + v_delta;
    if v_delta > 0 then
      update public.purchase_order_lines
        set received_qty = v_next
        where tenant_id = p_tenant and po_id = p_po and line_no = v_line.line_no;

      v_factor := coalesce(v_line.purchase_to_stock_factor, 1);
      v_stock_qty := v_delta * v_factor;
      v_stock_cost := case
        when v_line.unit_cost is null then null
        else v_line.unit_cost / v_factor
      end;

      perform public.post_stock_movement(
        p_tenant, v_line.product_id, v_po.location_id,
        'receipt', v_stock_qty, 'workflow',
        'receipt:po=' || p_po::text || ':line=' || v_line.line_no::text
          || ':key=' || p_idempotency_key,
        p_delivered_at,
        null, null, null, null,
        v_stock_cost, true);
    end if;
  end loop;

  if v_event <= 0 then raise exception 'nothing_received'; end if;

  update public.po_receipt_events
    set event_qty = v_event
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  v_in_full := v_received >= v_ordered;
  v_status := case when v_in_full then 'received' else 'partial_received' end;

  if v_po.expected_delivery_at is null then
    v_on_time := null;
  else
    v_on_time := (p_delivered_at at time zone 'UTC')::date
                 <= (v_po.expected_delivery_at at time zone 'UTC')::date;
  end if;
  v_otif := coalesce(v_on_time, true) and v_in_full;  -- no promise ⇒ OTIF follows in-full

  update public.purchase_orders
    set status = v_status::public.po_status, actual_delivery_at = p_delivered_at
    where tenant_id = p_tenant and id = p_po;

  insert into public.supplier_performance
    (tenant_id, supplier_id, po_id, promised_delivery_at, actual_delivery_at,
     promised_quantity, actual_quantity, on_time, in_full, on_time_in_full)
  values
    (p_tenant, v_po.supplier_id, p_po, v_po.expected_delivery_at, p_delivered_at,
     v_ordered, v_event, v_on_time, v_in_full, v_otif);

  return query select v_status, v_po.supplier_id, v_event, true;
end;
$$;

comment on function receive_purchase_order(uuid, uuid, timestamptz, jsonb, text) is
  'Atomic PO receipt (W2-2.5): idempotent on p_idempotency_key; clamps + '
  'applies per-line received qty in PURCHASE UoM, converts to stock UoM '
  '(× purchase_to_stock_factor) and posts through post_stock_movement — which '
  'moves on_hand/in_transit AND the moving-average cost (line unit_cost ÷ '
  'factor). supplier_performance stays purchase-UoM. Replay = no-op.';

-- ============================================================
-- 2a — apply_po_approval v2: in_transit commits in STOCK UoM
-- ============================================================
-- Block 11b committed ordered_qty into in_transit as-is; with purchase UoM
-- that number is now in purchase units, so the commitment converts by the same
-- factor the receipt will use — otherwise receive would decrement more (or
-- less) in_transit than approval added. Not a ledger movement (no goods moved
-- yet); this function is part of the kernel surface and documented with it.

create or replace function apply_po_approval(
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
declare
  v_po record;
  v_line record;
begin
  if p_target_status not in ('sent', 'exported') then
    raise exception 'bad_target_status';
  end if;

  select id, status, location_id, supplier_id
    into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po
  for update;
  if not found then raise exception 'po_not_found'; end if;

  if v_po.status not in ('draft', 'recommended') then
    return query select v_po.status::text, false;
    return;
  end if;

  for v_line in
    select pol.product_id,
           pol.ordered_qty * coalesce(ps.purchase_to_stock_factor, 1) as stock_qty
    from public.purchase_order_lines pol
    left join public.product_suppliers ps
      on ps.tenant_id = pol.tenant_id
     and ps.product_id = pol.product_id
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

comment on function apply_po_approval(uuid, uuid, text, text, text, int) is
  'Atomically advance a draft/recommended PO to sent|exported under a row lock '
  'and commit each ordered line as inventory_levels.in_transit in STOCK UoM '
  '(ordered_qty × purchase_to_stock_factor, W2-2.5). Idempotent: a PO already '
  'past draft returns out_applied=false without re-incrementing.';

-- ============================================================
-- 2a — convert_recommendations_to_po v2: order in PURCHASE UoM
-- ============================================================
-- Recommendations are computed in stock UoM (the policy engine's basis). PO
-- lines are purchase-UoM from this wave on, so conversion divides by the
-- factor (fractional allowed per MG — a recommendation of 30 eaches with a
-- 12-per-case factor orders 2.5 cases; the buyer rounds if their vendor
-- requires it). unit_cost from the supplier link is per PURCHASE unit when a
-- factor is set, so the PO total stays purchase-basis consistent.

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
  v_factor numeric;
  v_ordered numeric;
begin
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
    select unit_cost, coalesce(purchase_to_stock_factor, 1)
      into v_cost, v_factor
      from public.product_suppliers
      where tenant_id = p_tenant and product_id = r.product_id and supplier_id = v_supplier
      limit 1;
    v_factor := coalesce(v_factor, 1);        -- no supplier link row at all
    v_ordered := r.recommended_qty / v_factor;

    insert into public.purchase_order_lines
      (tenant_id, po_id, line_no, product_id, recommended_qty, ordered_qty, unit_cost)
    values (p_tenant, v_po, v_line_no, r.product_id, v_ordered, v_ordered, v_cost);

    v_total := v_total + coalesce(v_cost, 0) * v_ordered;

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
  'to one draft PO, converting stock-UoM recommended qty to PURCHASE UoM '
  '(÷ purchase_to_stock_factor, fractional allowed) and mark them converted. '
  'Row-locked.';

-- ============================================================
-- 2d — storeroom RPCs repost through the kernel
-- ============================================================
-- Orchestration (idempotency claim, validation, summaries) unchanged from
-- W2-2b; the inner insert+upsert pairs are replaced by post_stock_movement so
-- there is exactly one balance-mutation code path.

create or replace function post_issue_movements(
  p_tenant uuid,
  p_location uuid,
  p_movement text,
  p_demand_ref_type text,
  p_demand_ref_id text,
  p_reason_code text,
  p_note text,
  p_lines jsonb,
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

    perform public.post_stock_movement(
      p_tenant, v_line.product_id, p_location,
      p_movement, v_signed, 'manual',
      'issue:key=' || p_idempotency_key || ':product=' || v_line.product_id::text,
      now(), p_demand_ref_type, btrim(p_demand_ref_id),
      p_reason_code, p_note, null, false);

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
  'Storeroom issue (W2-2.5): validates + claims idempotency, then posts each '
  'line through post_stock_movement (the kernel). Quantities arrive positive; '
  'the sign follows the movement type. A kit = N rows sharing the demand ref.';

create or replace function post_stock_adjustment(
  p_tenant uuid,
  p_location uuid,
  p_product uuid,
  p_delta numeric,
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
  v_result record;
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

  select * into v_result from public.post_stock_movement(
    p_tenant, p_product, p_location,
    'adjustment', p_delta, 'manual',
    'adjust:key=' || p_idempotency_key,
    now(), null, null, p_reason_code, p_note, null, false);

  update public.inventory_op_events
    set summary = jsonb_build_object(
      'product_id', p_product, 'delta', p_delta, 'reason_code', btrim(p_reason_code))
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  return query select true, v_result.out_on_hand;
end;
$$;

comment on function post_stock_adjustment(uuid, uuid, uuid, numeric, text, text, uuid, text) is
  'Manual stock adjustment (W2-2.5): idempotency claim, then one signed '
  'correction through post_stock_movement (the kernel). Reason code required.';

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

  -- Idempotency claim BEFORE the terminal check (Codex round-1, W2-2): a
  -- same-key retry replays as a no-op; a raise below rolls the claim back.
  insert into public.inventory_op_events
    (tenant_id, kind, actor_user_id, idempotency_key)
  values (p_tenant, 'cycle_count_close', p_actor, p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select false, 0, 0, 0::numeric;
    return;
  end if;

  if v_session.status not in ('open', 'in_progress') then
    raise exception 'session_terminal';
  end if;

  for v_line in
    select product_id, expected_qty, counted_qty
    from public.cycle_count_lines
    where tenant_id = p_tenant and session_id = p_session
      and counted_qty is not null
  loop
    v_lines := v_lines + 1;

    -- Read the level under lock to compute the at-close delta; the kernel will
    -- re-lock (same txn, same row — Postgres row locks are reentrant within a
    -- transaction) and apply it. Counted quantity reconciles ON_HAND, which
    -- includes held stock: the count is a physical shelf count.
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
      perform public.post_stock_movement(
        p_tenant, v_line.product_id, v_session.location_id,
        'cycle_count', v_delta, 'manual',
        'count:session=' || p_session::text || ':product=' || v_line.product_id::text,
        now(), null, null, 'count_variance', null, null, false);
      v_moves := v_moves + 1;
      v_abs := v_abs + abs(v_delta);
    end if;

    update public.inventory_levels
      set last_counted_at = now()
      where tenant_id = p_tenant and product_id = v_line.product_id
        and location_id = v_session.location_id;

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
  'Cycle-count close (W2-2.5): reconciles each counted line to on_hand AT '
  'CLOSE and posts the delta through post_stock_movement (the kernel); stamps '
  'last_counted_at, records report variance vs expected_qty, completes the '
  'session. Idempotent on p_idempotency_key; re-close raises session_terminal.';

-- ============================================================
-- 2c — post_stock_hold: hold / release with the operator idempotency ledger
-- ============================================================

create or replace function post_stock_hold(
  p_tenant uuid,
  p_location uuid,
  p_product uuid,
  p_movement text,           -- 'hold' | 'release'
  p_qty numeric,             -- positive
  p_reason_code text,        -- qc_hold | damage_hold | release | ...
  p_note text,
  p_actor uuid,
  p_idempotency_key text
)
returns table (out_applied bool, out_on_hand numeric, out_on_hold numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result record;
begin
  if p_movement not in ('hold', 'release') then
    raise exception 'bad_movement';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'bad_qty'; end if;
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'missing_reason';
  end if;

  insert into public.inventory_op_events
    (tenant_id, kind, actor_user_id, idempotency_key)
  values (p_tenant, 'hold', p_actor, p_idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;
  if not found then
    return query select false, null::numeric, null::numeric;
    return;
  end if;

  select * into v_result from public.post_stock_movement(
    p_tenant, p_product, p_location,
    p_movement, p_qty, 'manual',
    p_movement || ':key=' || p_idempotency_key,
    now(), null, null, p_reason_code, p_note, null, false);

  update public.inventory_op_events
    set summary = jsonb_build_object(
      'movement', p_movement, 'product_id', p_product, 'qty', p_qty,
      'reason_code', btrim(p_reason_code))
    where tenant_id = p_tenant and idempotency_key = p_idempotency_key;

  return query select true, v_result.out_on_hand, v_result.out_on_hold;
end;
$$;

comment on function post_stock_hold(uuid, uuid, uuid, text, numeric, text, text, uuid, text) is
  'Stock hold/release (W2-2.5): idempotency claim, then one hold or release '
  'movement through post_stock_movement (the kernel) — moves the on_hold '
  'bucket, never on_hand. Held stock stays in valuation (MG 2026-07-09) and '
  'out of available-to-promise. Reason code required.';

-- ============================================================
-- 2d — onboarding seed posts through the kernel
-- ============================================================
-- The Block 2 fresh-path seed wrote on_hand with NO ledger row — the one
-- writer that broke ledger-replay before it ever started. It now posts the
-- delta as an onboarding adjustment through the kernel. The signature gains
-- p_tenant and the function moves to the service-role calling convention
-- (jwt_tenant_id() is null for the service role); the Server Action verifies
-- membership + role before calling, same as every other movement writer.

drop function if exists onboarding_seed_first_product(text, text, text, numeric);

create or replace function onboarding_seed_first_product(
  p_tenant uuid,
  p_sku text,
  p_name text,
  p_unit_of_measure text,
  p_on_hand numeric
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product uuid;
  v_location uuid;
  v_current numeric;
  v_delta numeric;
begin
  if p_tenant is null then raise exception 'no_tenant'; end if;

  insert into public.products (tenant_id, sku, name, unit_of_measure, status)
    values (p_tenant, p_sku, p_name, nullif(p_unit_of_measure, ''), 'active')
    returning id into v_product;

  select id into v_location
    from public.locations
    where tenant_id = p_tenant
    order by created_at asc
    limit 1;
  if v_location is null then
    insert into public.locations (tenant_id, name, type)
      values (p_tenant, 'Main', 'warehouse')
      returning id into v_location;
  end if;

  select on_hand into v_current
    from public.inventory_levels
    where tenant_id = p_tenant and product_id = v_product and location_id = v_location;
  v_delta := coalesce(p_on_hand, 0) - coalesce(v_current, 0);

  if v_delta <> 0 then
    perform public.post_stock_movement(
      p_tenant, v_product, v_location,
      'adjustment', v_delta, 'manual',
      'onboarding:product=' || v_product::text,
      now(), null, null, 'onboarding_seed', null, null, false);
  end if;

  update public.onboarding_state
    set catalog_minimum_met_at = now()
    where tenant_id = p_tenant
      and catalog_minimum_met_at is null;

  return v_product;
end;
$$;

comment on function onboarding_seed_first_product(uuid, text, text, text, numeric) is
  'Fresh-path onboarding seed (W2-2.5): creates the first product (+ Main '
  'location if none), then posts the starting on-hand as an onboarding_seed '
  'adjustment through post_stock_movement — the ledger now explains every '
  'balance from the tenant''s first minute. Service-role caller; the action '
  'gate verifies membership and role.';

-- ============================================================
-- 2b — valuation surface + seeded average costs
-- ============================================================

-- Per-SKU-per-location valuation. security_invoker: caller RLS fences rows.
-- total_value INCLUDES held stock (MG 2026-07-09 — you still own it);
-- held_value is broken out so the operator can read it either way.
create or replace view public.inventory_valuation_v
with (security_invoker = true) as
select
  il.tenant_id,
  il.product_id,
  p.sku,
  p.name,
  p.unit_of_measure,
  il.location_id,
  l.name as location_name,
  il.on_hand,
  il.on_hold,
  il.avg_unit_cost,
  il.avg_cost_provenance,
  case when il.avg_unit_cost is null then null
       else round(il.on_hand * il.avg_unit_cost, 2) end as total_value,
  case when il.avg_unit_cost is null then null
       else round(il.on_hold * il.avg_unit_cost, 2) end as held_value
from public.inventory_levels il
join public.products p
  on p.tenant_id = il.tenant_id and p.id = il.product_id
join public.locations l
  on l.tenant_id = il.tenant_id and l.id = il.location_id;

grant select on public.inventory_valuation_v to authenticated;

-- One set-based row per tenant for the valuation strip: total worth, held
-- worth, and how many stocked SKUs still have no cost (their worth is unknown,
-- not zero — the strip surfaces the gap instead of hiding it).
create or replace view public.inventory_valuation_totals_v
with (security_invoker = true) as
select
  il.tenant_id,
  sum(round(il.on_hand * il.avg_unit_cost, 2)) as total_value,
  sum(round(il.on_hold * il.avg_unit_cost, 2)) as held_value,
  count(distinct il.product_id) filter (
    where il.avg_unit_cost is null and il.on_hand <> 0
  ) as uncosted_skus
from public.inventory_levels il
group by il.tenant_id;

grant select on public.inventory_valuation_totals_v to authenticated;

-- The ledger list view gains the on-hold sum and the valued position so the
-- inventory page can show value without a second query. New columns append at
-- the end (create or replace view requires stable column order).
create or replace view public.inventory_list_v
with (security_invoker = true) as
select
  p.tenant_id,
  p.id,
  p.sku,
  p.name,
  p.status,
  p.unit_of_measure,
  coalesce(sum(il.on_hand), 0)    as on_hand,
  coalesce(sum(il.allocated), 0)  as allocated,
  coalesce(sum(il.in_transit), 0) as in_transit,
  pc.abc_class,
  pc.xyz_class,
  coalesce(sum(il.on_hold), 0)    as on_hold,
  sum(round(il.on_hand * il.avg_unit_cost, 2)) as total_value
from public.products p
left join public.inventory_levels il
  on il.tenant_id = p.tenant_id and il.product_id = p.id
left join public.product_classifications pc
  on pc.tenant_id = p.tenant_id and pc.product_id = p.id and pc.location_id is null
group by
  p.tenant_id, p.id, p.sku, p.name, p.status, p.unit_of_measure,
  pc.abc_class, pc.xyz_class;

-- Seed strategy for existing tenants (2b): initialize the moving average from
-- the primary supplier's unit_cost. At this migration's moment every
-- purchase_to_stock_factor is null (the column was just added), so the
-- supplier cost IS the stock-UoM cost — no conversion. Provenance 'seeded'
-- distinguishes these from posted receipts.
update inventory_levels il
set avg_unit_cost = ps.unit_cost,
    avg_cost_provenance = 'seeded'
from product_suppliers ps
where ps.tenant_id = il.tenant_id
  and ps.product_id = il.product_id
  and ps.is_primary
  and ps.unit_cost is not null
  and il.avg_unit_cost is null;

-- ============================================================
-- 2a — link_supplier v2: purchase UoM + conversion factor ride the link
-- ============================================================
-- New parameters default to null so the Block 4 call shape keeps working; the
-- factor CHECK (> 0) lives on the column. SECURITY INVOKER member path, same
-- as Block 4 — the supplier link is master data, not a balance.

drop function if exists public.link_supplier(uuid, uuid, numeric, int, int, boolean);

create or replace function public.link_supplier(
  p_product_id uuid,
  p_supplier_id uuid,
  p_unit_cost numeric,
  p_lead_time_days int,
  p_moq int,
  p_is_primary boolean,
  p_purchase_uom text default null,
  p_purchase_to_stock_factor numeric default null
) returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(p_is_primary, false) then
    update public.product_suppliers
      set is_primary = false
      where tenant_id = public.jwt_tenant_id()
        and product_id = p_product_id
        and is_primary = true;
  end if;

  insert into public.product_suppliers
    (tenant_id, product_id, supplier_id, unit_cost, lead_time_days, moq, is_primary,
     purchase_uom, purchase_to_stock_factor)
    values (public.jwt_tenant_id(), p_product_id, p_supplier_id,
            p_unit_cost, p_lead_time_days, p_moq, coalesce(p_is_primary, false),
            nullif(btrim(coalesce(p_purchase_uom, '')), ''), p_purchase_to_stock_factor);
end;
$$;

revoke execute on function public.link_supplier(uuid, uuid, numeric, int, int, boolean, text, numeric) from public;
grant execute on function public.link_supplier(uuid, uuid, numeric, int, int, boolean, text, numeric) to authenticated;

comment on function public.link_supplier(uuid, uuid, numeric, int, int, boolean, text, numeric) is
  'Atomically create a product↔supplier link, optionally primary (clears any '
  'prior primary). W2-2.5: carries the purchase UoM + purchase→stock factor '
  '(1 purchase unit = factor stock units; null = same unit, factor 1). '
  'unit_cost is per PURCHASE unit when a factor is set.';

-- ============================================================
-- 2d — enforcement: balances mutate ONLY through the kernel path
-- ============================================================
-- Member-role direct writes to the balance table and the ledger are revoked.
-- Every writer already runs through SECURITY INVOKER RPCs called by the
-- service role (which bypasses RLS) after an app-layer role gate; these
-- policies were the last door that let app code (or a compromised member
-- session) move balances without a ledger row. Member SELECT is unchanged.
drop policy if exists inventory_levels_insert on inventory_levels;
drop policy if exists inventory_levels_update on inventory_levels;
drop policy if exists stock_movements_insert on stock_movements;
