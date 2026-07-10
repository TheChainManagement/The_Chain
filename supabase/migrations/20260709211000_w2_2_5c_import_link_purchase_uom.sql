-- ============================================================
-- The Chain — W2-2.5c: import RPC learns the purchase-unit conversion
-- Source: docs/WAVE2_SCOPE.md (W2-2.5 UoM conversion)
-- ============================================================
--
-- W2-2.5b added purchase_uom + purchase_to_stock_factor to product_suppliers
-- (1 purchase unit = factor stock units; null = same unit). The W2-1a import
-- lane must land those columns too, or a CSV that carries them silently loses
-- the conversion. Same function, same signature (jsonb in), two more keys read
-- from each row: 'purchase_uom' (blank folds to null) and
-- 'purchase_to_stock_factor'. The writer (src/lib/import/commit.ts) enforces
-- both-or-neither + factor > 0 per row before rows reach this RPC; the table
-- CHECK (factor > 0) is the backstop.
--
-- Everything else is unchanged from 20260628140000: SECURITY INVOKER (RLS
-- owner|manager|planner gate), idempotent upsert on the (tenant, product,
-- supplier) PK, in-batch last-wins dedup, cheapest-link auto-primary.

create or replace function public.import_product_supplier_links(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with raw_input as (
    select
      (r.elem->>'product_id')::uuid as product_id,
      (r.elem->>'supplier_id')::uuid as supplier_id,
      nullif(r.elem->>'supplier_sku', '') as supplier_sku,
      (r.elem->>'unit_cost')::numeric as unit_cost,
      (r.elem->>'lead_time_days')::int as lead_time_days,
      (r.elem->>'moq')::int as moq,
      nullif(btrim(coalesce(r.elem->>'purchase_uom', '')), '') as purchase_uom,
      (r.elem->>'purchase_to_stock_factor')::numeric as purchase_to_stock_factor,
      r.ord as ord
    from jsonb_array_elements(p_rows) with ordinality as r(elem, ord)
  ),
  input as (
    -- Collapse duplicate (product, supplier) pairs in one file to the LAST row;
    -- a single INSERT ... ON CONFLICT cannot affect the same row twice.
    select distinct on (product_id, supplier_id)
      product_id, supplier_id, supplier_sku, unit_cost, lead_time_days, moq,
      purchase_uom, purchase_to_stock_factor
    from raw_input
    order by product_id, supplier_id, ord desc
  ),
  upserted as (
    insert into public.product_suppliers
      (tenant_id, product_id, supplier_id, supplier_sku, unit_cost, lead_time_days, moq,
       purchase_uom, purchase_to_stock_factor)
    select public.jwt_tenant_id(), i.product_id, i.supplier_id,
           i.supplier_sku, i.unit_cost, i.lead_time_days, i.moq,
           i.purchase_uom, i.purchase_to_stock_factor
    from input i
    on conflict (tenant_id, product_id, supplier_id) do update
      set supplier_sku             = excluded.supplier_sku,
          unit_cost                = excluded.unit_cost,
          lead_time_days           = excluded.lead_time_days,
          moq                      = excluded.moq,
          purchase_uom             = excluded.purchase_uom,
          purchase_to_stock_factor = excluded.purchase_to_stock_factor
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
  'W2-1a + W2-2.5c: batch upsert of product↔supplier links (resolved ids in) on '
  'the (tenant,product,supplier) PK, SECURITY INVOKER (RLS owner|manager|planner). '
  'Dedups duplicate pairs in-batch (last wins). Auto-promotes the cheapest link '
  'to primary for any product that has none. Carries the purchase-unit '
  'conversion (purchase_uom, purchase_to_stock_factor).';
