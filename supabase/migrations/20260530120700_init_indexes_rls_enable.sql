-- ============================================================
-- The Chain — Operational indexes + RLS enable (policies land in 5C)
-- Source: SYSTEM_DESIGN.md §Operational indexes + §RLS policy matrix
-- ============================================================

-- ----- Operational indexes (queries the product will actually run) -----

-- inventory_levels: list views by tenant + location, by tenant + product
create index ix_inventory_levels_tenant_location
  on inventory_levels (tenant_id, location_id);
create index ix_inventory_levels_tenant_product
  on inventory_levels (tenant_id, product_id);

-- stock_movements: feature acceptance read patterns
create index ix_stock_movements_tenant_product_occurred
  on stock_movements (tenant_id, product_id, occurred_at);
create index ix_stock_movements_tenant_location_occurred
  on stock_movements (tenant_id, location_id, occurred_at);

-- purchase_orders: late PO alerts + supplier views + reorder queue
create index ix_purchase_orders_tenant_status_eta
  on purchase_orders (tenant_id, status, expected_delivery_at);
create index ix_purchase_orders_tenant_supplier_status
  on purchase_orders (tenant_id, supplier_id, status);

-- reorder_recommendations: queue view
create index ix_reorder_recommendations_tenant_status_created
  on reorder_recommendations (tenant_id, status, created_at desc);

-- forecasts: latest run + per-product reads
create index ix_forecasts_tenant_computed
  on forecasts (tenant_id, computed_at desc);
create index ix_forecasts_tenant_product_location_computed
  on forecasts (tenant_id, product_id, location_id, computed_at desc);

-- forecast_evaluations: latest per forecast
create index ix_forecast_evaluations_forecast_evaluated
  on forecast_evaluations (forecast_id, evaluated_at desc);

-- supplier_performance: scorecard rollups
create index ix_supplier_performance_tenant_supplier_recorded
  on supplier_performance (tenant_id, supplier_id, recorded_at);

-- audit_log: list views + ROI queries
create index ix_audit_log_tenant_entity_occurred
  on audit_log (tenant_id, entity_type, occurred_at);
create index ix_audit_log_tenant_actor_occurred
  on audit_log (tenant_id, actor_user_id, occurred_at);

-- alerts: queue view (open by severity, by created_at desc)
create index ix_alerts_tenant_status_severity_created
  on alerts (tenant_id, status, severity, created_at desc);

-- sync_runs: history by tenant + connection
create index ix_sync_runs_tenant_connection_started
  on sync_runs (tenant_id, connection_id, started_at desc);

-- ----- RLS enable -----
-- Policies land in 5C. Enabling here keeps the schema closed-by-default.
alter table tenants                  enable row level security;
alter table profiles                 enable row level security;
alter table tenant_members           enable row level security;
alter table departments              enable row level security;
alter table subscriptions            enable row level security;
alter table locations                enable row level security;
alter table suppliers                enable row level security;
alter table products                 enable row level security;
alter table product_suppliers        enable row level security;
alter table classification_thresholds enable row level security;
alter table product_classifications  enable row level security;
alter table inventory_levels         enable row level security;
alter table stock_movements          enable row level security;
alter table reorder_recommendations  enable row level security;
alter table purchase_orders          enable row level security;
alter table purchase_order_lines     enable row level security;
alter table supplier_performance     enable row level security;
alter table supplier_scorecards      enable row level security;
alter table forecasts                enable row level security;
alter table forecast_points          enable row level security;
alter table forecast_evaluations     enable row level security;
alter table inventory_policy         enable row level security;
alter table category_benchmarks      enable row level security;
alter table onboarding_state         enable row level security;
alter table cycle_count_sessions     enable row level security;
alter table cycle_count_lines        enable row level security;
alter table source_connections       enable row level security;
alter table sync_runs                enable row level security;
alter table sync_failures            enable row level security;
alter table sync_conflicts           enable row level security;
alter table alerts                   enable row level security;
alter table notification_preferences enable row level security;
alter table insights                 enable row level security;
alter table audit_log                enable row level security;
alter table cold_archives            enable row level security;
