# Bench — inventory_list_v (5k SKUs, authenticated path)

Rows returned: 5000
Runs: 10 (after 1 warmup)
p50: 18.5 ms  (target < 600 ms)
p95: 20.1 ms  (target < 1200 ms)
min/max: 17.9 / 20.1 ms

NOTE: local Postgres on the dev box, not the Vercel Preview harness in
MASTER_PROMPT. Directional, not the official SLO number, but it exercises the
real RLS + view aggregation.

CORRECTION (2026-06-03, Codex round-2): an earlier note claimed "no seq scan."
That was an overclaim. The product lookup IS a Bitmap Index Scan on
products_tenant_id_sku_key (no seq scan there). But the plan below contains a
Seq Scan on public.product_classifications pc. It is harmless at this scale: the
bench tenant seeds no classification rows, so the scan hits 0 rows at ~0ms cost
(loops=5000 x rows=0). It will need an index once classifications are populated
(Block 7). The "no seq scan" phrasing in commit 4c32f22 was wrong and is retracted
here.

## EXPLAIN (ANALYZE, BUFFERS)
```
Sort  (cost=50.46..50.46 rows=1 width=228) (actual time=16.301..16.421 rows=5000 loops=1)
  Output: inventory_list_v.id, inventory_list_v.sku, inventory_list_v.name, inventory_list_v.status, inventory_list_v.unit_of_measure, inventory_list_v.on_hand, inventory_list_v.allocated, inventory_list_v.in_transit, inventory_list_v.abc_class, inventory_list_v.xyz_class
  Sort Key: inventory_list_v.sku
  Sort Method: quicksort  Memory: 665kB
  Buffers: shared hit=20121
  ->  Subquery Scan on inventory_list_v  (cost=50.40..50.45 rows=1 width=228) (actual time=10.595..13.400 rows=5000 loops=1)
        Output: inventory_list_v.id, inventory_list_v.sku, inventory_list_v.name, inventory_list_v.status, inventory_list_v.unit_of_measure, inventory_list_v.on_hand, inventory_list_v.allocated, inventory_list_v.in_transit, inventory_list_v.abc_class, inventory_list_v.xyz_class
        Buffers: shared hit=20121
        ->  GroupAggregate  (cost=50.40..50.44 rows=1 width=244) (actual time=10.594..13.140 rows=5000 loops=1)
              Output: p.tenant_id, p.id, p.sku, p.name, p.status, p.unit_of_measure, COALESCE(sum(il.on_hand), '0'::numeric), COALESCE(sum(il.allocated), '0'::numeric), COALESCE(sum(il.in_transit), '0'::numeric), pc.abc_class, pc.xyz_class
              Group Key: p.id, pc.abc_class, pc.xyz_class
              Buffers: shared hit=20121
              ->  Sort  (cost=50.40..50.41 rows=1 width=202) (actual time=10.587..10.836 rows=5000 loops=1)
                    Output: p.id, pc.abc_class, pc.xyz_class, p.tenant_id, p.sku, p.name, p.status, p.unit_of_measure, il.on_hand, il.allocated, il.in_transit
                    Sort Key: p.id, pc.abc_class, pc.xyz_class
                    Sort Method: quicksort  Memory: 743kB
                    Buffers: shared hit=20121
                    ->  Nested Loop Left Join  (cost=4.70..50.39 rows=1 width=202) (actual time=0.189..9.566 rows=5000 loops=1)
                          Output: p.id, pc.abc_class, pc.xyz_class, p.tenant_id, p.sku, p.name, p.status, p.unit_of_measure, il.on_hand, il.allocated, il.in_transit
                          Join Filter: (pc.product_id = p.id)
                          Buffers: shared hit=20121
                          ->  Nested Loop Left Join  (cost=4.70..47.99 rows=1 width=186) (actual time=0.184..7.405 rows=5000 loops=1)
                                Output: p.tenant_id, p.id, p.sku, p.name, p.status, p.unit_of_measure, il.on_hand, il.allocated, il.in_transit
                                Buffers: shared hit=15121
                                ->  Bitmap Heap Scan on public.products p  (cost=4.40..39.66 rows=1 width=132) (actual time=0.148..0.607 rows=5000 loops=1)
                                      Output: p.tenant_id, p.id, p.sku, p.name, p.description, p.unit_of_measure, p.attributes, p.status, p.primary_supplier_id, p.external_ids, p.external_updated_at, p.created_at, p.updated_at
                                      Recheck Cond: (p.tenant_id = (NULLIF(COALESCE(((COALESCE(NULLIF(current_setting('request.jwt.claim'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)))::jsonb ->> 'tenant_id'::text), ''::text), ''::text))::uuid)
                                      Filter: (p.status = 'active'::product_status)
                                      Heap Blocks: exact=89
                                      Buffers: shared hit=121
                                      ->  Bitmap Index Scan on products_tenant_id_sku_key  (cost=0.00..4.40 rows=12 width=0) (actual time=0.137..0.137 rows=5000 loops=1)
                                            Index Cond: (p.tenant_id = (NULLIF(COALESCE(((COALESCE(NULLIF(current_setting('request.jwt.claim'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)))::jsonb ->> 'tenant_id'::text), ''::text), ''::text))::uuid)
                                            Buffers: shared hit=32
                                ->  Index Scan using ix_inventory_levels_tenant_product on public.inventory_levels il  (cost=0.30..8.33 rows=1 width=86) (actual time=0.001..0.001 rows=1 loops=5000)
                                      Output: il.tenant_id, il.product_id, il.location_id, il.on_hand, il.allocated, il.in_transit, il.last_counted_at, il.updated_at
                                      Index Cond: ((il.tenant_id = (NULLIF(COALESCE(((COALESCE(NULLIF(current_setting('request.jwt.claim'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)))::jsonb ->> 'tenant_id'::text), ''::text), ''::text))::uuid) AND (il.product_id = p.id))
                                      Buffers: shared hit=15000
                          ->  Seq Scan on public.product_classifications pc  (cost=0.00..2.39 rows=1 width=48) (actual time=0.000..0.000 rows=0 loops=5000)
                                Output: pc.id, pc.tenant_id, pc.product_id, pc.location_id, pc.abc_class, pc.xyz_class, pc.adi, pc.cv_squared, pc.annual_consumption_value, pc.revenue_basis, pc.threshold_version_id, pc.computed_at
                                Filter: ((pc.location_id IS NULL) AND (pc.tenant_id = (NULLIF(COALESCE(((COALESCE(NULLIF(current_setting('request.jwt.claim'::text, true), ''::text), NULLIF(current_setting('request.jwt.claims'::text, true), ''::text)))::jsonb ->> 'tenant_id'::text), ''::text), ''::text))::uuid))
                                Buffers: shared hit=5000
Query Identifier: -521530938752086765
Planning:
  Buffers: shared hit=7
Planning Time: 0.245 ms
Execution Time: 16.553 ms
```
