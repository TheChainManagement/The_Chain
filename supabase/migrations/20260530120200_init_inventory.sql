-- ============================================================
-- The Chain — Locations, suppliers, products, inventory, stock movements (partitioned)
-- Source: SYSTEM_DESIGN.md §Locations and inventory + §Suppliers and procurement
-- ============================================================

create table locations (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  type location_type not null,
  address jsonb not null default '{}'::jsonb,
  active bool not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table suppliers (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  contact jsonb not null default '{}'::jsonb,
  default_lead_time_days int,
  min_order_value numeric(14,2),
  status supplier_status not null default 'active',
  external_ids jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  qbo_vendor_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);
create trigger suppliers_updated_at before update on suppliers
  for each row execute function set_updated_at();

create table products (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  sku text not null,
  name text not null,
  description text,
  unit_of_measure text,
  attributes jsonb not null default '{}'::jsonb,
  status product_status not null default 'active',
  primary_supplier_id uuid,
  external_ids jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, sku),
  foreign key (tenant_id, primary_supplier_id) references suppliers(tenant_id, id) on delete set null
);
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

create table product_suppliers (
  tenant_id uuid not null,
  product_id uuid not null,
  supplier_id uuid not null,
  supplier_sku text,
  unit_cost numeric(14,2),
  lead_time_days int,
  moq int,
  is_primary bool not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, product_id, supplier_id),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id) on delete cascade
);
-- Only one primary supplier per (tenant, product).
create unique index product_suppliers_one_primary
  on product_suppliers (tenant_id, product_id)
  where is_primary = true;

-- Versioned ABC/XYZ cutoffs.
create table classification_thresholds (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  version int not null,
  abc_cuts numeric[] not null,   -- e.g. [0.80, 0.95, 1.00]
  xyz_cuts numeric[] not null,   -- e.g. [0.5, 1.0]
  revenue_basis classification_revenue_basis not null default 'price',
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, version)
);

-- product_classifications: one row per (tenant, product, location). location_id
-- null means tenant-wide classification. Uniqueness enforced by partial indexes
-- because composite PK cannot contain expressions over nullable columns.
create table product_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid,
  abc_class char(1),
  xyz_class char(1),
  adi numeric,
  cv_squared numeric,
  annual_consumption_value numeric(16,2),
  revenue_basis classification_revenue_basis,
  threshold_version_id uuid,
  computed_at timestamptz not null default now(),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references locations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, threshold_version_id) references classification_thresholds(tenant_id, id)
);
create unique index product_classifications_uniq_tenant_wide
  on product_classifications (tenant_id, product_id)
  where location_id is null;
create unique index product_classifications_uniq_per_location
  on product_classifications (tenant_id, product_id, location_id)
  where location_id is not null;

create table inventory_levels (
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid not null,
  on_hand numeric(14,2) not null default 0,
  allocated numeric(14,2) not null default 0,
  in_transit numeric(14,2) not null default 0,
  last_counted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, product_id, location_id),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references locations(tenant_id, id) on delete cascade
);
create trigger inventory_levels_updated_at before update on inventory_levels
  for each row execute function set_updated_at();

-- stock_movements: append-only ledger, partitioned yearly by occurred_at.
-- PK must include the partition key (occurred_at).
create table stock_movements (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  product_id uuid not null,
  location_id uuid not null,
  type stock_movement_type not null,
  quantity numeric(14,2) not null,
  source stock_movement_source not null,
  source_ref text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (occurred_at, id),
  foreign key (tenant_id, product_id) references products(tenant_id, id),
  foreign key (tenant_id, location_id) references locations(tenant_id, id)
) partition by range (occurred_at);

-- Seeded partitions; coldArchiveWorkflow creates future years.
create table stock_movements_2026 partition of stock_movements
  for values from ('2026-01-01+00') to ('2027-01-01+00');
create table stock_movements_2027 partition of stock_movements
  for values from ('2027-01-01+00') to ('2028-01-01+00');
create table stock_movements_default partition of stock_movements default;
