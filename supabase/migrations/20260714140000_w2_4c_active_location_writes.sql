-- W2-4c: an archived location remains historical, never a destination for new
-- documents or physical stock activity. Enforce below the app/service-role path.

create or replace function public.guard_active_location_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.locations l
    where l.tenant_id = new.tenant_id
      and l.id = new.location_id
      and l.active
  ) then
    raise exception 'Active location not found.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger inventory_levels_active_location
before insert or update of location_id on public.inventory_levels
for each row execute function public.guard_active_location_write();

create trigger stock_movements_active_location
before insert or update of location_id on public.stock_movements
for each row execute function public.guard_active_location_write();

create trigger purchase_orders_active_location
before insert or update of location_id on public.purchase_orders
for each row execute function public.guard_active_location_write();

create trigger reorder_recommendations_active_location
before insert or update of location_id on public.reorder_recommendations
for each row execute function public.guard_active_location_write();

create trigger inventory_policy_active_location
before insert or update of location_id on public.inventory_policy
for each row execute function public.guard_active_location_write();

create trigger cycle_count_sessions_active_location
before insert or update of location_id on public.cycle_count_sessions
for each row execute function public.guard_active_location_write();

create trigger rfqs_active_location
before insert or update of location_id on public.rfqs
for each row execute function public.guard_active_location_write();

create trigger requisitions_active_location
before insert or update of location_id on public.requisitions
for each row execute function public.guard_active_location_write();

comment on function public.guard_active_location_write() is
  'W2-4c: prevents new operational rows from targeting archived or cross-tenant locations.';
