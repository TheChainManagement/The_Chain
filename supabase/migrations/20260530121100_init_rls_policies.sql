-- ============================================================
-- The Chain — RLS Policy Matrix
-- Source: SYSTEM_DESIGN.md §RLS policy matrix (verbatim)
-- Pattern:
--   "members"           = tenant_id = jwt_tenant_id()
--   "self"              = user_id = auth.uid()
--   "system only"       = NO mutation policy declared (service_role bypasses RLS)
--   role-gated mutation = AND has_role(<roles>) or is_owner()
-- ============================================================

-- ----- tenants -----
create policy tenants_select on tenants for select using (
  exists (select 1 from tenant_members tm
          where tm.tenant_id = tenants.id and tm.user_id = auth.uid())
);
create policy tenants_update on tenants for update using (
  id = jwt_tenant_id() and is_owner()
);
create policy tenants_delete on tenants for delete using (
  id = jwt_tenant_id() and is_owner()
);

-- ----- profiles -----
create policy profiles_select on profiles for select using (user_id = auth.uid());
create policy profiles_insert on profiles for insert with check (user_id = auth.uid());
create policy profiles_update on profiles for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----- tenant_members -----
create policy tenant_members_select on tenant_members for select using (
  tenant_id = jwt_tenant_id() or user_id = auth.uid()
);
create policy tenant_members_insert on tenant_members for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy tenant_members_update on tenant_members for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy tenant_members_delete on tenant_members for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- departments -----
create policy departments_select on departments for select using (tenant_id = jwt_tenant_id());
create policy departments_insert on departments for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy departments_update on departments for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy departments_delete on departments for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- subscriptions -----
create policy subscriptions_select on subscriptions for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','finance')
);
-- INSERT / UPDATE / DELETE = system only (service_role bypasses RLS).

-- ----- locations -----
create policy locations_select on locations for select using (tenant_id = jwt_tenant_id());
create policy locations_insert on locations for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy locations_update on locations for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy locations_delete on locations for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- suppliers -----
create policy suppliers_select on suppliers for select using (tenant_id = jwt_tenant_id());
create policy suppliers_insert on suppliers for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy suppliers_update on suppliers for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy suppliers_delete on suppliers for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- products -----
create policy products_select on products for select using (tenant_id = jwt_tenant_id());
create policy products_insert on products for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy products_update on products for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy products_delete on products for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- product_suppliers -----
create policy product_suppliers_select on product_suppliers for select using (tenant_id = jwt_tenant_id());
create policy product_suppliers_insert on product_suppliers for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy product_suppliers_update on product_suppliers for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy product_suppliers_delete on product_suppliers for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- classification_thresholds -----
create policy classification_thresholds_select on classification_thresholds for select using (tenant_id = jwt_tenant_id());
create policy classification_thresholds_insert on classification_thresholds for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy classification_thresholds_update on classification_thresholds for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy classification_thresholds_delete on classification_thresholds for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- product_classifications (system only) -----
create policy product_classifications_select on product_classifications for select using (tenant_id = jwt_tenant_id());

-- ----- inventory_levels -----
create policy inventory_levels_select on inventory_levels for select using (tenant_id = jwt_tenant_id());
create policy inventory_levels_insert on inventory_levels for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
create policy inventory_levels_update on inventory_levels for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);

-- ----- stock_movements (append-only) -----
create policy stock_movements_select on stock_movements for select using (tenant_id = jwt_tenant_id());
create policy stock_movements_insert on stock_movements for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
-- No update or delete: append-only.

-- ----- reorder_recommendations -----
create policy reorder_recommendations_select on reorder_recommendations for select using (tenant_id = jwt_tenant_id());
create policy reorder_recommendations_update on reorder_recommendations for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
-- INSERT = system (workflow). No delete.

-- ----- purchase_orders -----
create policy purchase_orders_select on purchase_orders for select using (tenant_id = jwt_tenant_id());
create policy purchase_orders_insert on purchase_orders for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy purchase_orders_update on purchase_orders for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy purchase_orders_delete on purchase_orders for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- purchase_order_lines -----
create policy purchase_order_lines_select on purchase_order_lines for select using (tenant_id = jwt_tenant_id());
create policy purchase_order_lines_insert on purchase_order_lines for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy purchase_order_lines_update on purchase_order_lines for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','planner')
);
create policy purchase_order_lines_delete on purchase_order_lines for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- supplier_performance (system only mutate; append-only) -----
create policy supplier_performance_select on supplier_performance for select using (tenant_id = jwt_tenant_id());

-- ----- supplier_scorecards (system only) -----
create policy supplier_scorecards_select on supplier_scorecards for select using (tenant_id = jwt_tenant_id());

-- ----- forecasts + forecast_points + forecast_evaluations + inventory_policy (system only) -----
create policy forecasts_select on forecasts for select using (tenant_id = jwt_tenant_id());
create policy forecast_points_select on forecast_points for select using (tenant_id = jwt_tenant_id());
create policy forecast_evaluations_select on forecast_evaluations for select using (tenant_id = jwt_tenant_id());
create policy inventory_policy_select on inventory_policy for select using (tenant_id = jwt_tenant_id());
create policy category_benchmarks_select on category_benchmarks for select using (tenant_id = jwt_tenant_id());

-- ----- onboarding_state -----
create policy onboarding_state_select on onboarding_state for select using (tenant_id = jwt_tenant_id());
create policy onboarding_state_insert on onboarding_state for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy onboarding_state_update on onboarding_state for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);

-- ----- cycle_count_sessions -----
create policy cycle_count_sessions_select on cycle_count_sessions for select using (tenant_id = jwt_tenant_id());
create policy cycle_count_sessions_insert on cycle_count_sessions for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
create policy cycle_count_sessions_update on cycle_count_sessions for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
create policy cycle_count_sessions_delete on cycle_count_sessions for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- cycle_count_lines -----
create policy cycle_count_lines_select on cycle_count_lines for select using (tenant_id = jwt_tenant_id());
create policy cycle_count_lines_insert on cycle_count_lines for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
create policy cycle_count_lines_update on cycle_count_lines for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','warehouse')
);
create policy cycle_count_lines_delete on cycle_count_lines for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- source_connections -----
create policy source_connections_select on source_connections for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy source_connections_insert on source_connections for insert with check (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy source_connections_update on source_connections for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy source_connections_delete on source_connections for delete using (
  tenant_id = jwt_tenant_id() and is_owner()
);

-- ----- sync_runs (system mutate; members select) -----
create policy sync_runs_select on sync_runs for select using (tenant_id = jwt_tenant_id());

-- ----- sync_failures (owner/manager select; system mutate) -----
create policy sync_failures_select on sync_failures for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);

-- ----- sync_conflicts (owner/manager select; resolve via update) -----
create policy sync_conflicts_select on sync_conflicts for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
create policy sync_conflicts_update on sync_conflicts for update using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);

-- ----- alerts -----
create policy alerts_select on alerts for select using (tenant_id = jwt_tenant_id());
create policy alerts_update on alerts for update using (tenant_id = jwt_tenant_id());

-- ----- notification_preferences (self) -----
create policy notification_preferences_select on notification_preferences for select using (
  user_id = auth.uid()
);
create policy notification_preferences_insert on notification_preferences for insert with check (
  user_id = auth.uid() and tenant_id = jwt_tenant_id()
);
create policy notification_preferences_update on notification_preferences for update using (
  user_id = auth.uid()
);
create policy notification_preferences_delete on notification_preferences for delete using (
  user_id = auth.uid()
);

-- ----- insights (system only mutate; members select) -----
create policy insights_select on insights for select using (tenant_id = jwt_tenant_id());

-- ----- audit_log (owner/manager/finance select; system only via trigger) -----
create policy audit_log_select on audit_log for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager','finance')
);

-- ----- cold_archives (owner/manager select; system mutate) -----
create policy cold_archives_select on cold_archives for select using (
  tenant_id = jwt_tenant_id() and has_role('owner','manager')
);
