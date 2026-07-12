-- ============================================================
-- The Chain — W2-3a: procurement schema (RFQ, requisition)
-- Source: docs/WAVE2_W2-3_PROCUREMENT_DESIGN.md §4/§5 (SIGNED OFF 2026-07-12)
-- ============================================================
--
-- First satellite module on the inventory posting kernel. Everything here is
-- DOCUMENTS: quote requests, vendor quotes, requisitions. This migration (and
-- the whole W2-3 module) performs ZERO balance writes — the only stock effects
-- in the flow remain the existing kernel-surface pair (apply_po_approval
-- commits in_transit at PO approval; receive_purchase_order posts receipts
-- through post_stock_movement). A probe test asserts the no-balance-writes
-- contract (tests/procurement/schema.test.ts).
--
-- MG-locked decisions (design §7, 2026-07-12):
--   * Single-step requisition approval, owner + manager, no self-approval
--     (approval enforcement is the slice-4 RPC/action gate; the schema carries
--     requested_by / approved_by / decided_at so thresholds bolt on in Wave 3).
--   * RFQ delivery = export-for-manual-send ('sent' is a status + document,
--     not an outbound email). Email-from-app is a fast-follow.
--   * Quote capture = manual entry by the operator into the comparison grid,
--     in PURCHASE UoM with the conversion factor snapshotted at entry.
--
-- House patterns throughout: tenant_id scoping + composite FKs, RLS per the
-- role matrix (writes = owner|manager|planner, the purchase_orders shape),
-- audit via the 5F dispatcher (trigger name MUST be audit_<table> — the
-- foundation discovery test enforces it), set_updated_at on header tables.

-- ============================================================
-- Enums
-- ============================================================

create type rfq_status as enum ('draft','sent','quoted','closed','canceled');
create type rfq_vendor_status as enum ('pending','quoted','declined');
create type requisition_status as enum
  ('draft','submitted','approved','rejected','converted','canceled');

-- ============================================================
-- RFQ: header, lines, vendor set, quotes
-- ============================================================

create table rfqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  location_id uuid not null,
  status rfq_status not null default 'draft',
  title text,
  note text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  respond_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references locations(tenant_id, id)
);
create trigger rfqs_updated_at before update on rfqs
  for each row execute function set_updated_at();
create index rfqs_tenant_status_idx on rfqs (tenant_id, status, created_at desc);

-- Lines carry qty in STOCK UoM (the engine's basis); the purchase-UoM
-- presentation happens per vendor at quote time.
create table rfq_lines (
  tenant_id uuid not null,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  line_no int not null,
  product_id uuid not null,
  qty numeric(14,2) not null check (qty > 0),
  note text,
  primary key (rfq_id, line_no),
  foreign key (tenant_id, product_id) references products(tenant_id, id)
);

-- One row per vendor the RFQ goes to (single OR multi per RFQ, MG decision
-- WAVE2_SCOPE §5.3). sent_at is stamped by the export action.
create table rfq_vendors (
  tenant_id uuid not null,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  supplier_id uuid not null,
  status rfq_vendor_status not null default 'pending',
  sent_at timestamptz,
  responded_at timestamptz,
  primary key (rfq_id, supplier_id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id) on delete cascade
);

-- Quotes: (vendor × line), costs in PURCHASE UoM. The conversion factor is a
-- SNAPSHOT at entry (defaulted from the supplier link by the UI) so an awarded
-- quote keeps meaning what it meant even if the link changes later.
create table rfq_vendor_quotes (
  tenant_id uuid not null,
  rfq_id uuid not null,
  supplier_id uuid not null,
  line_no int not null,
  quoted_unit_cost numeric(14,2) not null check (quoted_unit_cost >= 0),
  quoted_purchase_uom text,
  purchase_to_stock_factor numeric(14,4)
    check (purchase_to_stock_factor is null or purchase_to_stock_factor > 0),
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  moq int check (moq is null or moq >= 0),
  note text,
  entered_by_user_id uuid references auth.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  primary key (rfq_id, supplier_id, line_no),
  foreign key (rfq_id, line_no) references rfq_lines(rfq_id, line_no) on delete cascade,
  foreign key (rfq_id, supplier_id) references rfq_vendors(rfq_id, supplier_id) on delete cascade
);

-- ============================================================
-- Requisitions: header, lines
-- ============================================================

create table requisitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  location_id uuid not null,
  status requisition_status not null default 'draft',
  -- Nullable: the direct "approve what I already know I want" path needs no RFQ.
  source_rfq_id uuid references rfqs(id) on delete set null,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  rejection_note text,
  total numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, location_id) references locations(tenant_id, id)
);
create trigger requisitions_updated_at before update on requisitions
  for each row execute function set_updated_at();
create index requisitions_tenant_status_idx on requisitions (tenant_id, status, created_at desc);

-- Lines carry the CHOSEN vendor per line (a mixed-vendor requisition fans out
-- to one PO per supplier at conversion). Cost + UoM snapshots ride to the PO.
create table requisition_lines (
  tenant_id uuid not null,
  requisition_id uuid not null references requisitions(id) on delete cascade,
  line_no int not null,
  product_id uuid not null,
  supplier_id uuid not null,
  qty numeric(14,2) not null check (qty > 0),
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  purchase_uom text,
  purchase_to_stock_factor numeric(14,4)
    check (purchase_to_stock_factor is null or purchase_to_stock_factor > 0),
  -- Lineage back to the winning quote's line (header carries source_rfq_id).
  source_quote_line_no int,
  primary key (requisition_id, line_no),
  foreign key (tenant_id, product_id) references products(tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id)
);

-- POs remember which requisition created them (design §4).
alter table purchase_orders
  add column requisition_id uuid references requisitions(id) on delete set null;

-- ============================================================
-- RLS: role matrix (reads = tenant; writes = owner|manager|planner,
-- the purchase_orders shape; deletes = owner)
-- ============================================================

alter table rfqs enable row level security;
alter table rfq_lines enable row level security;
alter table rfq_vendors enable row level security;
alter table rfq_vendor_quotes enable row level security;
alter table requisitions enable row level security;
alter table requisition_lines enable row level security;

do $$
declare
  t text;
  procurement_tables text[] := array[
    'rfqs', 'rfq_lines', 'rfq_vendors', 'rfq_vendor_quotes',
    'requisitions', 'requisition_lines'
  ];
begin
  foreach t in array procurement_tables loop
    execute format(
      'create policy %I on public.%I for select using (tenant_id = jwt_tenant_id())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert with check '
      '(tenant_id = jwt_tenant_id() and has_role(''owner'',''manager'',''planner''))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using '
      '(tenant_id = jwt_tenant_id() and has_role(''owner'',''manager'',''planner''))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using '
      '(tenant_id = jwt_tenant_id() and is_owner())',
      t || '_delete', t);
  end loop;
end;
$$;

-- ============================================================
-- Audit: attach the 5F dispatcher (trigger name = audit_<table>)
-- ============================================================

do $$
declare
  t text;
  procurement_tables text[] := array[
    'rfqs', 'rfq_lines', 'rfq_vendors', 'rfq_vendor_quotes',
    'requisitions', 'requisition_lines'
  ];
begin
  foreach t in array procurement_tables loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.capture_audit()',
      'audit_' || t, t
    );
  end loop;
end;
$$;
