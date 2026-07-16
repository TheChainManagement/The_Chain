-- W2-4e: align transfers with the established service-role balance-writer pattern.
-- The old six-argument SECURITY DEFINER overload must be removed explicitly;
-- adding p_actor changes the PostgreSQL function identity.

drop function public.execute_stock_transfer(uuid, uuid, uuid, uuid, numeric, text);

create function public.execute_stock_transfer(
  p_tenant uuid,
  p_product uuid,
  p_source uuid,
  p_destination uuid,
  p_quantity numeric,
  p_idempotency_key text,
  p_actor uuid
)
returns table (
  out_applied boolean,
  out_transfer_id uuid,
  out_source_on_hand numeric,
  out_destination_on_hand numeric
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.stock_transfer_events%rowtype;
  v_source public.inventory_levels%rowtype;
  v_destination public.inventory_levels%rowtype;
  v_source_safety numeric := 0;
  v_available numeric;
  v_now timestamptz := clock_timestamp();
  v_ref text;
begin
  if p_source = p_destination then raise exception 'same_location'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'bad_qty'; end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'missing_idempotency_key';
  end if;
  if not exists (
    select 1 from public.products p
    where p.tenant_id = p_tenant and p.id = p_product and p.status = 'active'
  ) then raise exception 'product_not_found'; end if;
  if (select count(*) from public.locations l
      where l.tenant_id = p_tenant and l.id in (p_source, p_destination) and l.active) <> 2 then
    raise exception 'active_location_not_found';
  end if;

  -- Serialize identical requests before the replay lookup so concurrent retries
  -- observe the first committed event instead of racing the unique constraint.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant::text || ':' || p_idempotency_key, 0)
  );

  select * into v_event
  from public.stock_transfer_events e
  where e.tenant_id = p_tenant and e.idempotency_key = p_idempotency_key;
  if found then
    select * into v_source from public.inventory_levels
      where tenant_id = p_tenant and product_id = p_product and location_id = p_source;
    select * into v_destination from public.inventory_levels
      where tenant_id = p_tenant and product_id = p_product and location_id = p_destination;
    return query select false, v_event.id, v_source.on_hand, v_destination.on_hand;
    return;
  end if;

  insert into public.inventory_levels (tenant_id, product_id, location_id, on_hand)
  values (p_tenant, p_product, p_source, 0),
         (p_tenant, p_product, p_destination, 0)
  on conflict (tenant_id, product_id, location_id) do nothing;

  -- Identical lock order for opposing concurrent transfers prevents deadlocks.
  perform 1 from public.inventory_levels il
  where il.tenant_id = p_tenant and il.product_id = p_product
    and il.location_id in (p_source, p_destination)
  order by il.location_id
  for update;

  select * into v_source from public.inventory_levels
  where tenant_id = p_tenant and product_id = p_product and location_id = p_source;
  select * into v_destination from public.inventory_levels
  where tenant_id = p_tenant and product_id = p_product and location_id = p_destination;
  select coalesce(ip.safety_stock, 0) into v_source_safety
  from public.inventory_policy ip
  where ip.tenant_id = p_tenant and ip.product_id = p_product and ip.location_id = p_source;
  v_source_safety := coalesce(v_source_safety, 0);
  v_available := v_source.on_hand - v_source.on_hold - v_source.allocated - v_source_safety;
  if p_quantity > v_available then raise exception 'insufficient_transferable_stock'; end if;

  insert into public.stock_transfer_events
    (tenant_id, product_id, source_location_id, destination_location_id,
     quantity, actor_user_id, idempotency_key)
  values
    (p_tenant, p_product, p_source, p_destination, p_quantity,
     p_actor, p_idempotency_key)
  returning * into v_event;

  v_ref := 'transfer:' || v_event.id::text;
  perform * from public.post_stock_movement(
    p_tenant, p_product, p_source, 'transfer_out', -p_quantity,
    'workflow', v_ref || ':out', v_now,
    null, null, 'location_transfer', v_ref, null, false
  );
  perform * from public.post_stock_movement(
    p_tenant, p_product, p_destination, 'transfer_in', p_quantity,
    'workflow', v_ref || ':in', v_now + interval '1 microsecond',
    null, null, 'location_transfer', v_ref, v_source.avg_unit_cost, false
  );

  select * into v_source from public.inventory_levels
  where tenant_id = p_tenant and product_id = p_product and location_id = p_source;
  select * into v_destination from public.inventory_levels
  where tenant_id = p_tenant and product_id = p_product and location_id = p_destination;
  return query select true, v_event.id, v_source.on_hand, v_destination.on_hand;
end;
$$;

revoke all on function public.execute_stock_transfer(uuid, uuid, uuid, uuid, numeric, text, uuid)
  from public;
grant execute on function public.execute_stock_transfer(uuid, uuid, uuid, uuid, numeric, text, uuid)
  to authenticated, service_role;

comment on function public.execute_stock_transfer(uuid, uuid, uuid, uuid, numeric, text, uuid) is
  'W2-4e: SECURITY INVOKER atomic paired transfer. The tenant/role gate lives in the '
  'Server Action, which calls this function with the service-role client and explicit actor.';
