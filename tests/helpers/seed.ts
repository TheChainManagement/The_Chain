import type { Client } from 'pg';

/**
 * Seed one representative row into every tenant-scoped table for a tenant, in FK
 * order, as a single PL/pgSQL block. Runs as the superuser (RLS bypassed), so it
 * populates both the tenant under test and the "other" tenant the cross-tenant
 * probe must never see. Audit rows are produced by the 5F triggers as a side
 * effect of the tracked inserts.
 */
function seedBlock(tenantId: string, userId: string, salt: string): string {
  return `do $$
declare
  t uuid := '${tenantId}';
  u uuid := '${userId}';
  v_dept uuid := gen_random_uuid();
  v_loc uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_ct uuid := gen_random_uuid();
  v_forecast uuid := gen_random_uuid();
  v_po uuid := gen_random_uuid();
  v_conn uuid := gen_random_uuid();
  v_syncrun uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
begin
  insert into profiles (user_id, active_tenant_id) values (u, t);
  insert into tenant_members (tenant_id, user_id, role) values (t, u, 'owner');
  insert into subscriptions (tenant_id, status, trial_start, trial_end, retention_tier)
    values (t, 'trial', now(), now() + interval '14 days', 'free');
  insert into departments (tenant_id, id, name) values (t, v_dept, 'Operations');
  insert into locations (tenant_id, id, name, type) values (t, v_loc, 'Main DC', 'warehouse');
  insert into suppliers (tenant_id, id, name) values (t, v_sup, 'Acme Supply ${salt}');
  insert into products (tenant_id, id, sku, name, primary_supplier_id)
    values (t, v_prod, 'SKU-${salt}', 'Widget', v_sup);
  insert into product_suppliers (tenant_id, product_id, supplier_id, is_primary)
    values (t, v_prod, v_sup, true);
  insert into classification_thresholds (tenant_id, id, version, abc_cuts, xyz_cuts)
    values (t, v_ct, 1, array[0.8, 0.95, 1.0], array[0.5, 1.0]);
  insert into product_classifications (tenant_id, product_id, abc_class, xyz_class, threshold_version_id)
    values (t, v_prod, 'A', 'X', v_ct);
  insert into inventory_levels (tenant_id, product_id, location_id, on_hand, allocated, in_transit)
    values (t, v_prod, v_loc, 100, 10, 5);
  insert into stock_movements (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
    values (t, v_prod, v_loc, 'receipt', 50, 'manual', now());
  insert into forecasts (tenant_id, id, product_id, location_id, aggregation_level, method, horizon_days, run_id)
    values (t, v_forecast, v_prod, v_loc, 'sku_location', 'croston', 30, gen_random_uuid());
  insert into forecast_points (tenant_id, forecast_id, period_date, mean)
    values (t, v_forecast, current_date, 12.5);
  insert into forecast_evaluations (tenant_id, forecast_id, rmsse, wape, beats_baseline)
    values (t, v_forecast, 0.8, 0.2, true);
  insert into inventory_policy (tenant_id, product_id, location_id, lead_time_days_used, reorder_point)
    values (t, v_prod, v_loc, 7, 40);
  insert into category_benchmarks (tenant_id, category, trimmed_mean_daily_demand)
    values (t, 'fasteners', 3.2);
  insert into reorder_recommendations (tenant_id, product_id, location_id, supplier_id, recommended_qty)
    values (t, v_prod, v_loc, v_sup, 25);
  insert into purchase_orders (tenant_id, id, supplier_id, location_id, status, total)
    values (t, v_po, v_sup, v_loc, 'draft', 1000);
  insert into purchase_order_lines (tenant_id, po_id, line_no, product_id, ordered_qty)
    values (t, v_po, 1, v_prod, 25);
  insert into supplier_performance (tenant_id, supplier_id, po_id, on_time, in_full)
    values (t, v_sup, v_po, true, true);
  insert into supplier_scorecards (tenant_id, supplier_id, window_kind, otif_pct)
    values (t, v_sup, 'rolling_30d', 0.95);
  insert into onboarding_state (tenant_id, path) values (t, 'qbo');
  insert into cycle_count_sessions (tenant_id, id, location_id, created_by_user_id)
    values (t, v_session, v_loc, u);
  insert into cycle_count_lines (tenant_id, session_id, product_id, expected_qty, counted_qty)
    values (t, v_session, v_prod, 100, 98);
  insert into source_connections (tenant_id, id, source, status) values (t, v_conn, 'qbo', 'active');
  insert into sync_runs (tenant_id, id, connection_id, status) values (t, v_syncrun, v_conn, 'completed');
  insert into sync_failures (tenant_id, sync_run_id, error_code) values (t, v_syncrun, 'E_PARSE');
  insert into sync_conflicts (tenant_id, source_connection_id, entity_type, policy_decision)
    values (t, v_conn, 'product', 'needs_review');
  insert into alerts (tenant_id, kind, dedupe_key, severity) values (t, 'reorder_due', 'rd-${salt}', 'warn');
  insert into notification_preferences (tenant_id, user_id, channel, kind)
    values (t, u, 'in_app', 'reorder_due');
  insert into insights (tenant_id, entity_type, entity_id, model, prompt_version, content)
    values (t, 'product', v_prod, 'claude-x', 'v1', '{"note":"ok"}'::jsonb);
  insert into cold_archives (tenant_id, partition_name, source_table, blob_url)
    values (t, 'audit_log_2026', 'audit_log', 'https://blob.example/${salt}');
end $$;`;
}

export interface SeededTenant {
  tenantId: string;
  userId: string;
}

/** Create a tenant + its owner auth user, then seed one row in every table. */
export async function seedTenant(
  client: Client,
  tenantId: string,
  userId: string,
  salt: string,
): Promise<SeededTenant> {
  await client.query(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [
    tenantId,
    `Tenant ${salt}`,
    `tenant-${salt}`,
  ]);
  await client.query(
    `insert into auth.users (id, instance_id, email) values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [userId, `owner-${salt}@example.test`],
  );
  await client.query(seedBlock(tenantId, userId, salt));
  return { tenantId, userId };
}
