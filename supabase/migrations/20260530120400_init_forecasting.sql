-- ============================================================
-- The Chain — Forecasting + policy
-- Source: SYSTEM_DESIGN.md §Forecasting and policy
-- ============================================================

create table forecasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid,
  aggregation_level forecast_aggregation_level not null,
  method forecast_method not null,
  horizon_days int not null,
  confidence_level numeric(5,4),
  training_cutoff_at timestamptz,
  test_window_start timestamptz,
  test_window_end timestamptz,
  eligibility_threshold_met bool not null default false,
  cold_start_state cold_start_state not null default 'cold',
  promoted bool not null default false,
  run_id uuid not null,
  computed_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references locations(tenant_id, id) on delete cascade
);

-- Idempotency for forecast batch: one promoted forecast per (tenant, product, location, run).
create unique index forecasts_unique_per_run
  on forecasts (tenant_id, product_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), run_id);

create table forecast_points (
  tenant_id uuid not null,
  forecast_id uuid not null references forecasts(id) on delete cascade,
  period_date date not null,
  mean numeric(14,4),
  lower_bound numeric(14,4),
  upper_bound numeric(14,4),
  primary key (forecast_id, period_date)
);

create table forecast_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  forecast_id uuid not null references forecasts(id) on delete cascade,
  baseline_method forecast_method not null default 'seasonal_naive',
  baseline_forecast_values jsonb,
  rolling_origin_windows int,
  rmsse numeric,
  wape numeric,
  beats_baseline bool,
  evaluated_at timestamptz not null default now()
);

create table inventory_policy (
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid not null,
  service_level numeric(5,4) not null default 0.97,
  lead_time_days_used numeric not null,
  demand_during_lead_time numeric(14,2),
  safety_stock numeric(14,2),
  reorder_point numeric(14,2),
  recommended_order_qty numeric(14,2),
  days_of_supply numeric,
  stockout_risk_score numeric(5,4),
  based_on_forecast_id uuid references forecasts(id) on delete set null,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, product_id, location_id),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references locations(tenant_id, id) on delete cascade
);

-- Category benchmarks for cold-start forecasting (per FEATURES.md §Demand forecasting).
create table category_benchmarks (
  tenant_id uuid not null references tenants(id),
  category text not null,
  trimmed_mean_daily_demand numeric(14,4),
  sample_size int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, category)
);
