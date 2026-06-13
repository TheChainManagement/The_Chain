-- ============================================================
-- Block 11b — approve → stock-in-transit, and receive → on-hand
-- ============================================================
-- Block 11a turned reorder recommendations into a DRAFT purchase order. This
-- wave closes the product's primary loop: approve the draft (write it back to
-- QBO, commit the capital as in-transit) and receive it (move the goods from
-- in-transit to on-hand, writing the receipt ledger that the forecast reads).
--
-- Two atomic RPCs + one idempotency ledger:
--   * apply_po_approval   — draft → sent|exported under a row lock; in_transit
--                           += ordered per line. The QBO push (I/O) happens in
--                           TS before this; the durable external ids ride in.
--   * receive_purchase_order (v2) — extends Block 10 so the SAME txn that
--                           advances status + writes supplier_performance now
--                           ALSO writes stock_movements (type=receipt) and moves
--                           inventory_levels (on_hand += delta, in_transit -=
--                           delta). A receipt is no longer fire-and-forget: it
--                           is idempotent on a caller key so a double-submit
--                           cannot double-count on_hand.
--   * po_receipt_events   — the idempotency ledger (one row per applied receipt
--                           event), unique on (tenant_id, idempotency_key).
--
-- SECURITY INVOKER, service-role caller (inventory_levels + supplier_performance
-- are system-write; the action gate authorizes the role before calling).

-- ----- receipt idempotency ledger -----

create table po_receipt_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  idempotency_key text not null,
  event_qty numeric(14,2) not null,
  applied_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

alter table po_receipt_events enable row level security;

-- Member-readable within the tenant (the receipt history is operator-facing);
-- writes go through the service-role RPC, so no member write policy.
create policy po_receipt_events_select on po_receipt_events
  for select using (tenant_id = jwt_tenant_id());

-- Every tenant-scoped table carries the audit dispatcher (5J hardening). The
-- hardening loop only covered tables that existed when it ran, so a new table
-- attaches its own.
create trigger audit_po_receipt_events
  after insert or update or delete on po_receipt_events
  for each row execute function capture_audit();

-- ----- approval: draft → in-flight, capital becomes in-transit -----

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

  select id, status, location_id
    into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po
  for update;
  if not found then raise exception 'po_not_found'; end if;

  -- Idempotent: once it has advanced past draft the approval already ran (a
  -- retried workflow step or a double-click). Return the current state, no
  -- re-increment of in_transit.
  if v_po.status not in ('draft', 'recommended') then
    return query select v_po.status::text, false;
    return;
  end if;

  for v_line in
    select product_id, ordered_qty
    from public.purchase_order_lines
    where tenant_id = p_tenant and po_id = p_po
  loop
    -- The PO line guarantees a product; the inventory row may not exist yet for
    -- a never-stocked SKU, so upsert the in-transit commitment.
    insert into public.inventory_levels (tenant_id, product_id, location_id, in_transit)
    values (p_tenant, v_line.product_id, v_po.location_id, v_line.ordered_qty)
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
  'and commit each ordered line as inventory_levels.in_transit. Idempotent: a '
  'PO already past draft returns out_applied=false without re-incrementing. '
  'External ids (from the QBO push that ran in TS first) ride in and persist.';

-- ----- receive (v2): write the stock the forecast reads -----

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

  -- Idempotency gate FIRST, under the PO row lock: a replayed receipt (same key)
  -- must not re-apply line qty, re-write stock, or insert a second performance
  -- row. The ledger insert is the guard — if the key already landed, FOUND is
  -- false and we return the current state untouched.
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
    select line_no, product_id, ordered_qty, received_qty
    from public.purchase_order_lines
    where tenant_id = p_tenant and po_id = p_po
  loop
    v_add := coalesce((p_lines ->> v_line.line_no::text)::numeric, 0);
    if v_add < 0 then v_add := 0; end if;
    v_next := least(v_line.ordered_qty, v_line.received_qty + v_add);  -- clamp at ordered
    v_delta := v_next - v_line.received_qty;                          -- THIS line's delta
    v_ordered := v_ordered + v_line.ordered_qty;
    v_received := v_received + v_next;
    v_event := v_event + v_delta;
    if v_delta > 0 then
      update public.purchase_order_lines
        set received_qty = v_next
        where tenant_id = p_tenant and po_id = p_po and line_no = v_line.line_no;

      -- The append-only receipt ledger the forecast + DOS math read from.
      insert into public.stock_movements
        (tenant_id, product_id, location_id, type, quantity, source, source_ref, occurred_at)
      values
        (p_tenant, v_line.product_id, v_po.location_id, 'receipt', v_delta, 'workflow',
         'receipt:po=' || p_po::text || ':line=' || v_line.line_no::text
           || ':key=' || p_idempotency_key, p_delivered_at);

      -- Goods land: in_transit (committed at approval) becomes on_hand.
      insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand, in_transit)
      values (p_tenant, v_line.product_id, v_po.location_id, v_delta, 0)
      on conflict (tenant_id, product_id, location_id)
        do update set
          on_hand = public.inventory_levels.on_hand + excluded.on_hand,
          in_transit = greatest(0, public.inventory_levels.in_transit - v_delta);
    end if;
  end loop;

  if v_event <= 0 then raise exception 'nothing_received'; end if;

  -- Record the real per-event qty on the ledger row we just claimed.
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

-- The Block 10 signature (no idempotency key) is replaced by this 5-arg version.
drop function if exists receive_purchase_order(uuid, uuid, timestamptz, jsonb);

comment on function receive_purchase_order(uuid, uuid, timestamptz, jsonb, text) is
  'Atomic PO receipt (Block 11b): idempotent on p_idempotency_key. Clamps + '
  'applies per-line received qty, writes a receipt stock_movement + moves '
  'inventory_levels (on_hand += delta, in_transit -= delta), advances status, '
  'and records ONE supplier_performance row with the per-EVENT quantity. A '
  'replayed key returns out_applied=false and changes nothing.';
