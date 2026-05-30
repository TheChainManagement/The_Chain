-- ============================================================
-- The Chain — Alerts, insights, audit log (partitioned), cold archives
-- Source: SYSTEM_DESIGN.md §Alerts, insights, audit + §Retention + tiered visibility
-- ============================================================

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind alert_kind not null,
  entity_type text,
  entity_id uuid,
  dedupe_key text not null,
  severity alert_severity not null default 'info',
  last_severity alert_severity not null default 'info',
  condition_first_seen_at timestamptz not null default now(),
  reopen_count int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  status alert_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger alerts_updated_at before update on alerts
  for each row execute function set_updated_at();

-- Dedupe: one open alert per (tenant, dedupe_key).
create unique index alerts_open_unique
  on alerts (tenant_id, dedupe_key)
  where status = 'open';

create table notification_preferences (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel notification_channel not null,
  kind alert_kind not null,
  enabled bool not null default true,
  primary key (tenant_id, user_id, channel, kind)
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  entity_type text not null,
  entity_id uuid not null,
  model text not null,
  prompt_version text not null,
  content jsonb not null,
  confidence numeric(5,4),
  created_at timestamptz not null default now()
);
-- Idempotency on (tenant, entity, prompt_version).
create unique index insights_unique_per_entity_prompt
  on insights (tenant_id, entity_type, entity_id, prompt_version);

-- ----- audit_log: append-only, partitioned yearly by occurred_at -----
-- Use a global sequence so id is monotonic across partitions.
create sequence audit_log_id_seq;

create table audit_log (
  id bigint not null default nextval('audit_log_id_seq'),
  tenant_id uuid not null,
  actor_user_id uuid,
  request_id text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now(),
  primary key (occurred_at, id),
  foreign key (tenant_id) references tenants(id)
) partition by range (occurred_at);

create table audit_log_2026 partition of audit_log
  for values from ('2026-01-01+00') to ('2027-01-01+00');
create table audit_log_2027 partition of audit_log
  for values from ('2027-01-01+00') to ('2028-01-01+00');
create table audit_log_default partition of audit_log default;

-- cold_archives: records partitions detached + uploaded to Vercel Blob.
create table cold_archives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  partition_name text not null,
  source_table text not null,         -- 'audit_log' | 'stock_movements'
  blob_url text not null,
  bytes bigint,
  archived_at timestamptz not null default now()
);
