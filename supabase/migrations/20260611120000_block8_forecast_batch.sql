-- ============================================================
-- Block 8 Wave 2b — durable forecast batch contract gaps
-- Source: FEATURES.md §Demand forecasting pipeline
-- ============================================================

-- FEATURES.md names `tenants.forecast_concurrency_limit` (default 4) as the
-- shard fan-out cap for forecastTenantBatchWorkflow. Additive — no wave needed
-- it until the batch existed.
alter table tenants
  add column forecast_concurrency_limit int not null default 4;
comment on column tenants.forecast_concurrency_limit is
  'Max forecast shard workflows running concurrently for this tenant. '
  'Backpressure halves the effective value for a run on shard failure.';

-- The forecast batch tracks itself in sync_runs (FEATURES: sharding visible in
-- sync_runs.error_log) but has no source connection — it reads stock_movements
-- regardless of where they came from. Relax the NOT NULL; integration syncs keep
-- writing a connection_id.
alter table sync_runs
  alter column connection_id drop not null;
comment on column sync_runs.connection_id is
  'Source connection for integration syncs (qbo/csv/...). NULL for system batch '
  'runs that have no source, e.g. the nightly forecast batch.';

-- Cold SKUs get category-benchmark forecast points, never a model prediction
-- (FEATURES eligibility ladder). Their forecasts row needs an honest method
-- value — recording them as a model would be a lie.
alter type forecast_method add value if not exists 'benchmark';

-- The 2c chart contract shows BOTH 80% and 95% bands. forecast_points carried a
-- single pair (the forecasts.confidence_level band = 95%); add the inner 80%
-- band alongside. Additive, nullable — benchmark fills have no bands.
alter table forecast_points
  add column lower_bound_80 numeric(14,4),
  add column upper_bound_80 numeric(14,4);
comment on column forecast_points.lower_bound is
  'Outer band lower bound at forecasts.confidence_level (default 0.95).';
comment on column forecast_points.lower_bound_80 is
  'Inner 80% band lower bound. NULL for category-benchmark fills.';

-- Batch coverage polls count one run's forecasts; the existing indexes lead with
-- product/computed_at, not run.
create index ix_forecasts_tenant_run on forecasts (tenant_id, run_id);
