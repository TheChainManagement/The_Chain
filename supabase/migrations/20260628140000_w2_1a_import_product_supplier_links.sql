-- ============================================================
-- The Chain — W2-1a: product↔supplier link import RPC
-- Source: docs/WAVE2_SCOPE.md (W2-1 data-model cleanup)
-- ============================================================
--
-- The CSV import gains a fourth lane: product↔supplier links (cost / lead time /
-- MOQ / supplier SKU). This closes the eval gap where a full catalog's terms had
-- to be SQL-seeded by hand because no import covered product_suppliers.
--
-- The writer (src/lib/import/commit.ts) resolves SKU → product_id (case-sensitive)
-- and supplier name → supplier_id (case-insensitive) and reports per-row failures
-- for anything unresolved, then hands RESOLVED rows to this RPC. The RPC does the
-- atomic DB write the way import_suppliers does: SECURITY INVOKER so the
-- product_suppliers RLS owner|manager|planner gate holds, tenant from
-- jwt_tenant_id(), idempotent upsert on the (tenant, product, supplier) PK.
--
-- Auto-primary: a product with NO primary supplier gets its cheapest link promoted
-- (lowest unit_cost, then supplier_id). The policy/reorder engine reads cost basis
-- from the primary link, so a bulk import lands ready to forecast without a manual
-- "set primary" pass. We only set a primary where none exists, so the partial
-- unique index product_suppliers_one_primary is never violated.

create or replace function public.import_product_supplier_links(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with input as (
    select
      (r->>'product_id')::uuid as product_id,
      (r->>'supplier_id')::uuid as supplier_id,
      nullif(r->>'supplier_sku', '') as supplier_sku,
      (r->>'unit_cost')::numeric as unit_cost,
      (r->>'lead_time_days')::int as lead_time_days,
      (r->>'moq')::int as moq
    from jsonb_array_elements(p_rows) as r
  ),
  upserted as (
    insert into public.product_suppliers
      (tenant_id, product_id, supplier_id, supplier_sku, unit_cost, lead_time_days, moq)
    select public.jwt_tenant_id(), i.product_id, i.supplier_id,
           i.supplier_sku, i.unit_cost, i.lead_time_days, i.moq
    from input i
    on conflict (tenant_id, product_id, supplier_id) do update
      set supplier_sku   = excluded.supplier_sku,
          unit_cost      = excluded.unit_cost,
          lead_time_days = excluded.lead_time_days,
          moq            = excluded.moq
    returning 1
  )
  select count(*) into v_count from upserted;

  -- Promote a primary for any product touched by this batch that has none.
  with touched as (
    select distinct (r->>'product_id')::uuid as product_id
    from jsonb_array_elements(p_rows) as r
  ),
  needs_primary as (
    select t.product_id
    from touched t
    where not exists (
      select 1 from public.product_suppliers ps
      where ps.tenant_id = public.jwt_tenant_id()
        and ps.product_id = t.product_id
        and ps.is_primary
    )
  ),
  pick as (
    select distinct on (ps.product_id) ps.product_id, ps.supplier_id
    from public.product_suppliers ps
    join needs_primary np on np.product_id = ps.product_id
    where ps.tenant_id = public.jwt_tenant_id()
    order by ps.product_id, ps.unit_cost asc nulls last, ps.supplier_id
  )
  update public.product_suppliers ps
  set is_primary = true
  from pick
  where ps.tenant_id = public.jwt_tenant_id()
    and ps.product_id = pick.product_id
    and ps.supplier_id = pick.supplier_id;

  return v_count;
end;
$$;

comment on function public.import_product_supplier_links(jsonb) is
  'W2-1a: batch upsert of product↔supplier links (resolved ids in) on the '
  '(tenant,product,supplier) PK, SECURITY INVOKER (RLS owner|manager|planner). '
  'Auto-promotes the cheapest link to primary for any product that has none.';
