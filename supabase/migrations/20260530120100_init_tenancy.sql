-- ============================================================
-- The Chain — Tenancy + identity
-- Source: SYSTEM_DESIGN.md §Identity, tenancy, billing
-- ============================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  token_generation int not null default 1,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on column tenants.token_generation is
  'Incremented on tenant_members role change or membership removal. '
  'JWT carries this value; middleware rejects stale-generation sessions.';

-- profiles is the app-level user metadata; auth.users is Supabase-managed.
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  active_tenant_id uuid references tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

create table departments (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table tenant_members (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  department_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, department_id) references departments(tenant_id, id) on delete set null
);

create table subscriptions (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  status subscription_status not null default 'trial',
  trial_start timestamptz,
  trial_end timestamptz,
  plan_code text,
  retention_tier retention_tier not null default 'free',
  billing_customer_id text,
  billing_provider text,
  comp_reason text,
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- Bump tenants.token_generation when a member's role changes or membership is
-- removed, forcing JWT refresh per the auth security model.
create or replace function bump_tenant_token_generation()
returns trigger as $$
begin
  if (tg_op = 'UPDATE' and new.role is distinct from old.role) or tg_op = 'DELETE' then
    update tenants
      set token_generation = token_generation + 1
      where id = coalesce(new.tenant_id, old.tenant_id);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger tenant_members_role_change
  after update or delete on tenant_members
  for each row execute function bump_tenant_token_generation();
