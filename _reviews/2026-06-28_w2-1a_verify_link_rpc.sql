-- W2-1a verification: import_product_supplier_links RPC, run against the local DB.
-- Exercises the three behaviors the integration test can't reach when local GoTrue
-- auth is down: (1) auto-promote the cheapest link to primary when a product has
-- none; (2) preserve an existing primary; (3) in-batch dedup of duplicate
-- (product, supplier) pairs (last wins) so a single INSERT ... ON CONFLICT never
-- hits "cannot affect row a second time". Run in a rolled-back transaction:
--   docker exec -i supabase_db_the-chain psql -U postgres -d postgres \
--     -f _reviews/2026-06-28_w2-1a_verify_link_rpc.sql
\set ON_ERROR_STOP on
begin;

insert into tenants (id, name, slug)
  values ('11111111-1111-1111-1111-111111111111', 'RPC Test', 'rpc-test-w21a');
insert into products (tenant_id, id, sku, name, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'WID-1', 'Widget One', 'active'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'WID-2', 'Widget Two', 'active');
insert into suppliers (tenant_id, id, name, status, contact) values
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'Atlas Supply', 'active', '{}'),
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'Borden Co', 'active', '{}');

-- WID-2 already has a primary supplier (Atlas) — the import must NOT steal it.
insert into product_suppliers (tenant_id, product_id, supplier_id, unit_cost, is_primary) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 9.00, true);

select set_config('request.jwt.claims', '{"tenant_id":"11111111-1111-1111-1111-111111111111","tenant_role":"owner"}', true);

-- Note the WID-1 + Atlas pair appears TWICE (4.50 then 4.99) — in-batch dedup must
-- collapse it to the last value (4.99) without crashing.
select 'imported' as label, public.import_product_supplier_links('[
  {"product_id":"22222222-2222-2222-2222-222222222222","supplier_id":"44444444-4444-4444-4444-444444444444","unit_cost":4.50,"lead_time_days":7,"moq":24,"supplier_sku":"AT-1"},
  {"product_id":"22222222-2222-2222-2222-222222222222","supplier_id":"55555555-5555-5555-5555-555555555555","unit_cost":4.10,"lead_time_days":10,"moq":12,"supplier_sku":null},
  {"product_id":"22222222-2222-2222-2222-222222222222","supplier_id":"44444444-4444-4444-4444-444444444444","unit_cost":4.99,"lead_time_days":8,"moq":24,"supplier_sku":"AT-1"},
  {"product_id":"33333333-3333-3333-3333-333333333333","supplier_id":"55555555-5555-5555-5555-555555555555","unit_cost":3.00,"lead_time_days":5,"moq":6,"supplier_sku":null}
]'::jsonb) as count;

-- Expected: WID-1 → 2 links (Atlas dedup'd to 4.99, Borden 4.10), primary = Borden
--           (cheapest). WID-2 → 2 links, primary = Atlas (unchanged).
select
  p.sku,
  count(*) as links,
  sum((ps.is_primary)::int) as primaries,
  (select s.name from product_suppliers x join suppliers s on s.tenant_id=x.tenant_id and s.id=x.supplier_id
     where x.tenant_id=ps.tenant_id and x.product_id=ps.product_id and x.is_primary) as primary_supplier,
  (select x.unit_cost from product_suppliers x
     where x.tenant_id=ps.tenant_id and x.product_id=ps.product_id
       and x.supplier_id='44444444-4444-4444-4444-444444444444') as atlas_cost
from product_suppliers ps
join products p on p.tenant_id=ps.tenant_id and p.id=ps.product_id
where ps.tenant_id='11111111-1111-1111-1111-111111111111'
group by p.sku, ps.tenant_id, ps.product_id
order by p.sku;

rollback;
