-- ============================================================
-- The Chain — Onboarding state, cycle counts, integrations (source_connections, sync runs/failures/conflicts)
-- Source: SYSTEM_DESIGN.md §Onboarding + §Cycle counts + §Integrations and sync
-- ============================================================

create table onboarding_state (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  path onboarding_path not null,
  started_at timestamptz not null default now(),
  source_connected_at timestamptz,
  catalog_minimum_met_at timestamptz,
  suppliers_minimum_met_at timestamptz,
  first_forecast_ready_at timestamptz,
  completed_at timestamptz,
  minimum_fields_met jsonb not null default '{}'::jsonb,
  seed_only_opt_in bool not null default false
);

create table cycle_count_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  location_id uuid not null,
  status cycle_count_status not null default 'open',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  foreign key (tenant_id, location_id) references locations(tenant_id, id)
);

create table cycle_count_lines (
  tenant_id uuid not null,
  session_id uuid not null references cycle_count_sessions(id) on delete cascade,
  product_id uuid not null,
  expected_qty numeric(14,2),
  counted_qty numeric(14,2),
  variance numeric(14,2),
  notes text,
  counted_at timestamptz,
  counted_by_user_id uuid references auth.users(id) on delete set null,
  primary key (session_id, product_id),
  foreign key (tenant_id, product_id) references products(tenant_id, id)
);

create table source_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  source source_kind not null,
  status source_connection_status not null default 'connecting',
  encrypted_credentials bytea,  -- pgsodium-encrypted; decrypted only inside "use step" contexts
  external_account_id text,
  last_synced_at timestamptz,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  connection_id uuid not null references source_connections(id) on delete cascade,
  workflow_run_id text,
  status sync_run_status not null default 'queued',
  cursor jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  entities_processed jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb
);

create table sync_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  sync_run_id uuid not null references sync_runs(id) on delete cascade,
  entity_type text,
  external_ref text,
  payload jsonb,
  error_code text,
  error_message text,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  dead_letter bool not null default false,
  resolution_status sync_failure_resolution not null default 'pending',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  source_connection_id uuid not null references source_connections(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  external_ref text,
  local_state jsonb,
  remote_state jsonb,
  policy_decision sync_conflict_policy_decision not null,
  applied_resolution sync_conflict_resolution not null default 'pending',
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
