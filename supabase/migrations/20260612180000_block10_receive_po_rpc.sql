-- ============================================================
-- Block 10 (Codex round-1) — atomic PO receipt
-- ============================================================
-- The receipt write was a non-transactional sequence (line updates → status →
-- performance insert), and it stored the CUMULATIVE received quantity as the
-- per-event actual_quantity — so the 2nd receipt of a 60/40 split recorded
-- "delivered 100, in full", corrupting supplier_performance and every OTIF
-- rollup downstream. supplier_performance feeds policy + money, and a receipt
-- is NOT idempotent, so this runs atomically under a PO row lock and records
-- the per-EVENT quantity.
--
-- SECURITY INVOKER, service-role caller (supplier_performance is system-write;
-- the action gate authorizes). On-time/in-full follow the same rule as the pure
-- `assessReceipt`: on-time = delivered ≤ promised by UTC day; in-full = the
-- order is complete after this event; OTIF = on-time (or no-promise) AND
-- in-full.

create or replace function receive_purchase_order(
  p_tenant uuid,
  p_po uuid,
  p_delivered_at timestamptz,
  p_lines jsonb
)
returns table (out_status text, out_supplier_id uuid, out_event_qty numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_po record;
  v_line record;
  v_add numeric;
  v_next numeric;
  v_ordered numeric := 0;
  v_received numeric := 0;
  v_event numeric := 0;
  v_in_full bool;
  v_on_time bool;
  v_otif bool;
  v_status text;
begin
  select id, supplier_id, status, expected_delivery_at
    into v_po
  from public.purchase_orders
  where tenant_id = p_tenant and id = p_po
  for update;
  if not found then raise exception 'po_not_found'; end if;
  if v_po.status in ('received', 'closed', 'canceled') then
    raise exception 'po_terminal';
  end if;

  for v_line in
    select line_no, ordered_qty, received_qty
    from public.purchase_order_lines
    where tenant_id = p_tenant and po_id = p_po
  loop
    v_add := coalesce((p_lines ->> v_line.line_no::text)::numeric, 0);
    if v_add < 0 then v_add := 0; end if;
    v_next := least(v_line.ordered_qty, v_line.received_qty + v_add);  -- clamp at ordered
    v_ordered := v_ordered + v_line.ordered_qty;
    v_received := v_received + v_next;
    v_event := v_event + (v_next - v_line.received_qty);              -- THIS event's delta
    if v_add > 0 then
      update public.purchase_order_lines
        set received_qty = v_next
        where tenant_id = p_tenant and po_id = p_po and line_no = v_line.line_no;
    end if;
  end loop;

  if v_event <= 0 then raise exception 'nothing_received'; end if;

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

  return query select v_status, v_po.supplier_id, v_event;
end;
$$;

-- Note: OUT columns are prefixed `out_` so they never shadow a table column
-- referenced inside the body (e.g. purchase_orders.supplier_id).

comment on function receive_purchase_order(uuid, uuid, timestamptz, jsonb) is
  'Atomic PO receipt: clamps + applies per-line received qty under a row lock, '
  'advances status, and records ONE supplier_performance row with the per-EVENT '
  'quantity (not cumulative). p_lines = { "<line_no>": <qty received this event> }.';
