-- ============================================================
-- The Chain — Reorder recommendations, purchase orders, supplier performance + scorecards
-- Source: SYSTEM_DESIGN.md §Suppliers and procurement
-- ============================================================

create table reorder_recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid not null,
  supplier_id uuid,
  recommended_qty numeric(14,2) not null,
  reason jsonb not null default '{}'::jsonb,
  based_on_forecast_id uuid,
  based_on_policy_id uuid,
  source recommendation_source not null default 'system',
  status recommendation_status not null default 'open',
  version int not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id) on delete set null
);
create trigger reorder_recommendations_updated_at before update on reorder_recommendations
  for each row execute function set_updated_at();

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  supplier_id uuid not null,
  location_id uuid not null,
  status po_status not null default 'draft',
  recommendation_id uuid references reorder_recommendations(id) on delete set null,
  recommended_by po_recommended_by not null default 'system',
  created_by_user_id uuid references auth.users(id) on delete set null,
  total numeric(14,2),
  expected_delivery_at timestamptz,
  actual_delivery_at timestamptz,
  external_po_id text,
  external_version int,
  last_synced_at timestamptz,
  sync_status po_sync_status not null default 'in_sync',
  version int not null default 1,  -- internal idempotency version
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, location_id) references locations(tenant_id, id)
);
create trigger purchase_orders_updated_at before update on purchase_orders
  for each row execute function set_updated_at();

create table purchase_order_lines (
  tenant_id uuid not null,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  line_no int not null,
  product_id uuid not null,
  recommended_qty numeric(14,2),
  ordered_qty numeric(14,2) not null,
  received_qty numeric(14,2) not null default 0,
  unit_cost numeric(14,2),
  primary key (po_id, line_no),
  foreign key (tenant_id, product_id) references products(tenant_id, id)
);

-- supplier_performance: timeseries, one row per PO receipt event.
create table supplier_performance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  supplier_id uuid not null,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  promised_delivery_at timestamptz,
  actual_delivery_at timestamptz,
  promised_quantity numeric(14,2),
  actual_quantity numeric(14,2),
  on_time bool,
  in_full bool,
  on_time_in_full bool,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id) on delete cascade
);

-- supplier_scorecards: materialized rollup keyed by window.
-- NB: the time-window column is named `window_kind`, NOT `window` — `window` is
-- a reserved keyword in Postgres (window functions) and is a syntax error as a
-- bare column name. Caught when the suite first ran against real Postgres (5F).
create type scorecard_window as enum ('rolling_30d','rolling_90d','rolling_365d','all_time');

create table supplier_scorecards (
  tenant_id uuid not null,
  supplier_id uuid not null,
  window_kind scorecard_window not null,
  otif_pct numeric(5,4),
  on_time_pct numeric(5,4),
  in_full_pct numeric(5,4),
  lead_time_avg_days numeric,
  lead_time_stddev_days numeric,
  sample_size int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, supplier_id, window_kind),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id) on delete cascade
);
