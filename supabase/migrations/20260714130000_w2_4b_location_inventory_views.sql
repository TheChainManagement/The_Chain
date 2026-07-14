-- W2-4b: location-scoped inventory read model. The tenant-wide view remains
-- intact for All locations and existing integrations.

create or replace view public.inventory_location_list_v
with (security_invoker = true) as
select
  p.tenant_id,
  p.id,
  p.sku,
  p.name,
  p.status,
  p.unit_of_measure,
  l.id as location_id,
  coalesce(il.on_hand, 0) as on_hand,
  coalesce(il.allocated, 0) as allocated,
  coalesce(il.in_transit, 0) as in_transit,
  coalesce(pc_loc.abc_class, pc_all.abc_class) as abc_class,
  coalesce(pc_loc.xyz_class, pc_all.xyz_class) as xyz_class,
  coalesce(il.on_hold, 0) as on_hold,
  case when il.avg_unit_cost is null then null
       else round(il.on_hand * il.avg_unit_cost, 2) end as total_value
from public.products p
join public.locations l
  on l.tenant_id = p.tenant_id and l.active
left join public.inventory_levels il
  on il.tenant_id = p.tenant_id and il.product_id = p.id and il.location_id = l.id
left join public.product_classifications pc_loc
  on pc_loc.tenant_id = p.tenant_id and pc_loc.product_id = p.id
 and pc_loc.location_id = l.id
left join public.product_classifications pc_all
  on pc_all.tenant_id = p.tenant_id and pc_all.product_id = p.id
 and pc_all.location_id is null;

grant select on public.inventory_location_list_v to authenticated;
