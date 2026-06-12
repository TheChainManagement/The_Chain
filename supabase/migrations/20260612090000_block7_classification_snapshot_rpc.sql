-- ============================================================
-- Block 7 fix (caught by the Block 8 batch's second live run) —
-- atomic classification snapshot replace
-- ============================================================
-- `classifyTenant` wrote the new snapshot with insert-new-THEN-delete-old for
-- crash-safety, but `product_classifications_uniq_tenant_wide` (partial unique
-- on (tenant_id, product_id) where location_id is null, in place since
-- Foundation) makes the second insert fail before the delete ever runs: every
-- recompute after the first errored. PostgREST upserts cannot target a partial
-- unique index (ON CONFLICT needs the index predicate), so the replace happens
-- here in one transaction: delete the tenant-wide snapshot, insert the new one.
-- Atomic, so the "delete landed but insert didn't" window cannot exist.
--
-- SECURITY INVOKER, service-role caller (the table is system-write).

create or replace function replace_classification_snapshot(p_tenant uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted int;
begin
  delete from public.product_classifications
  where tenant_id = p_tenant and location_id is null;

  insert into public.product_classifications
    (tenant_id, product_id, location_id, abc_class, xyz_class, adi, cv_squared,
     annual_consumption_value, revenue_basis, threshold_version_id, computed_at)
  select
    p_tenant,
    (r->>'product_id')::uuid,
    null,
    (r->>'abc_class')::char(1),
    (r->>'xyz_class')::char(1),
    (r->>'adi')::numeric,
    (r->>'cv_squared')::numeric,
    (r->>'annual_consumption_value')::numeric,
    coalesce((r->>'revenue_basis')::public.classification_revenue_basis, 'cost'),
    (r->>'threshold_version_id')::uuid,
    coalesce((r->>'computed_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function replace_classification_snapshot(uuid, jsonb) is
  'Atomic tenant-wide ABC/XYZ snapshot replace. Fixes the recompute failure '
  'against product_classifications_uniq_tenant_wide.';
