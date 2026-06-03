-- ============================================================
-- The Chain — Phase 6 Block 3: index-optimized inventory list view
-- Source: Codex review 2026-06-02 ("5k performance not delivered; no aggregate,
--   no index-plan"). The app aggregated on-hand in TS over an embed, which does
--   not scale to the 5,000-SKU acceptance target. This pushes the per-SKU sum +
--   tenant-wide classification join into one set-based query the planner can hit
--   with the Foundation indexes on inventory_levels(tenant_id, product_id).
--
-- SECURITY INVOKER (PG15+): the view runs as the querying user, so RLS on
--   products / inventory_levels / product_classifications still fences every row
--   to the caller's tenant. The view adds no new trust surface.
-- ============================================================

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
  pc.xyz_class
from public.products p
left join public.inventory_levels il
  on il.tenant_id = p.tenant_id and il.product_id = p.id
left join public.product_classifications pc
  on pc.tenant_id = p.tenant_id and pc.product_id = p.id and pc.location_id is null
group by
  p.tenant_id, p.id, p.sku, p.name, p.status, p.unit_of_measure,
  pc.abc_class, pc.xyz_class;

grant select on public.inventory_list_v to authenticated;
