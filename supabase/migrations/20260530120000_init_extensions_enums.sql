-- ============================================================
-- The Chain — Phase 5B Schema (init: extensions + enums + helpers)
-- Source: SYSTEM_DESIGN.md §Database schema
-- ============================================================

-- Extensions
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive slug, email
-- pgsodium is deprecated on new Supabase projects (PG15+). source_connections
-- .encrypted_credentials stays bytea; encryption-at-rest will use Supabase Vault
-- (or app-side) when the QBO OAuth feature lands. Try to enable it where it is
-- still available (e.g. the local CLI stack); skip silently where it is not.
do $$
begin
  create extension if not exists pgsodium;
exception
  when others then
    raise notice 'pgsodium not available on this instance; skipping (encrypted_credentials remains bytea)';
end
$$;

-- Helper: updated_at trigger function
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ----- Enums -----
do $$ begin
  -- Identity / billing
  create type member_role as enum ('owner','manager','planner','warehouse','finance','viewer');
  create type subscription_status as enum ('trial','active','past_due','canceled','comp');
  create type retention_tier as enum ('free','starter','standard','pro','enterprise');

  -- Locations + inventory
  create type location_type as enum ('warehouse','store','plant','third_party','consignment');
  create type product_status as enum ('active','discontinued');
  create type classification_revenue_basis as enum ('cost','price');
  create type stock_movement_type as enum ('sale','receipt','transfer_in','transfer_out','adjustment','cycle_count');
  create type stock_movement_source as enum ('qbo','rutter','csv','manual','api','workflow');

  -- Suppliers + procurement
  create type supplier_status as enum ('active','archived');
  create type po_status as enum ('draft','recommended','approved','exported','sent','partial_received','received','closed','canceled');
  create type po_recommended_by as enum ('system','user','external');
  create type po_sync_status as enum ('in_sync','local_ahead','external_ahead','conflict');
  create type recommendation_source as enum ('system','user');
  create type recommendation_status as enum ('open','converted','dismissed','expired');

  -- Forecasting
  create type forecast_method as enum ('croston','sba','tsb','auto_ets','auto_arima','seasonal_naive');
  create type forecast_aggregation_level as enum ('sku','sku_location','sku_channel');
  create type cold_start_state as enum ('cold','warming','warm');

  -- Cycle counts + onboarding
  create type cycle_count_status as enum ('open','in_progress','completed','canceled');
  create type onboarding_path as enum ('qbo','csv','fresh');

  -- Integrations + sync
  create type source_kind as enum ('qbo','rutter','csv','api','cin7','fishbowl','katana','zoho','unleashed');
  create type source_connection_status as enum ('connecting','active','expired','error');
  create type sync_run_status as enum ('queued','running','completed','failed','canceled');
  create type sync_conflict_policy_decision as enum ('server_wins','last_write_wins','needs_review');
  create type sync_conflict_resolution as enum ('accept_local','accept_remote','merge','pending');
  create type sync_failure_resolution as enum ('pending','retrying','resolved','abandoned');

  -- Alerts + notifications
  create type alert_kind as enum (
    'stockout_risk','reorder_due','overstock','po_late','sync_failure',
    'sync_conflict','forecast_low_confidence','forecast_baseline_fail'
  );
  create type alert_severity as enum ('info','warn','critical');
  create type alert_status as enum ('open','acknowledged','dismissed','auto_closed');
  create type notification_channel as enum ('in_app','email');
exception when duplicate_object then null;
end $$;
