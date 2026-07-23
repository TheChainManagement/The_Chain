// W3 wave-close TEST_KIT fixture: a six-role tenant with two locations, a scoped
// member, requester/approver authority, promoted forecasts, an in-transit PO, and
// a UoM-less reorder recommendation (exercises the round-4 conversion fix).
// Local-only fixture (like seed-storeroom-demo.mjs). See TEST_KIT_W3.md for creds.
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await c.connect();

const USERS = [
  ['owner.kit@thechain.test', 'OwnerKit123!', 'owner', 'all'],
  ['manager.kit@thechain.test', 'ManagerKit123!', 'manager', 'all'],
  ['planner.kit@thechain.test', 'PlannerKit123!', 'planner', 'all'],
  ['warehouse.kit@thechain.test', 'WarehouseKit123!', 'warehouse', 'scoped'],
  ['finance.kit@thechain.test', 'FinanceKit123!', 'finance', 'all'],
  ['viewer.kit@thechain.test', 'ViewerKit123!', 'viewer', 'all'],
];

async function ensureUser(email, password) {
  const existing = await c.query('select id from auth.users where email = $1', [email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

const t = await c.query(
  `insert into tenants (name, slug, operating_mode) values ('Gulf Coast Supply Co', 'w3-testkit', 'distribution')
   on conflict (slug) do update set operating_mode = 'distribution' returning id`,
);
const tenantId = t.rows[0].id;

await c.query(
  `insert into subscriptions (tenant_id, status, trial_start, trial_end, plan_code, retention_tier)
   values ($1, 'active', now(), now() + interval '1 year', 'growth', 'standard')
   on conflict (tenant_id) do update set status = 'active'`,
  [tenantId],
);

async function ensureLocation(name, isPrimary) {
  const found = await c.query('select id from locations where tenant_id = $1 and name = $2', [
    tenantId,
    name,
  ]);
  if (found.rows[0]) return found.rows[0].id;
  const ins = await c.query(
    `insert into locations (tenant_id, name, type, location_kind, is_primary)
     values ($1, $2, 'warehouse', 'stockroom', $3) returning id`,
    [tenantId, name, isPrimary],
  );
  return ins.rows[0].id;
}
const houstonId = await ensureLocation('Houston Hub', true);
const batonRougeId = await ensureLocation('Baton Rouge Yard', false);

const userIds = {};
for (const [email, password, role, scope] of USERS) {
  const uid = await ensureUser(email, password);
  userIds[role] = uid;
  await c.query(
    `insert into profiles (user_id, active_tenant_id) values ($1, $2)
     on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id`,
    [uid, tenantId],
  );
  // The W3-3 contract trigger requires an assignment before all_locations can be
  // false, so scoped members are created wide, assigned, then narrowed.
  await c.query(
    `insert into tenant_members (tenant_id, user_id, role, all_locations)
     values ($1, $2, $3, true)
     on conflict (tenant_id, user_id) do update set role = excluded.role`,
    [tenantId, uid, role],
  );
  if (scope === 'scoped') {
    await c.query(
      `insert into tenant_member_locations (tenant_id, user_id, location_id)
       values ($1, $2, $3) on conflict do nothing`,
      [tenantId, uid, batonRougeId],
    );
    await c.query(
      `update tenant_members set all_locations = false where tenant_id = $1 and user_id = $2`,
      [tenantId, uid],
    );
  }
}

// W3-5 authority: planner auto-approves up to $500; manager can approve up to $5,000.
await c.query(
  `insert into tenant_member_requisition_authority
     (tenant_id, user_id, requester_mode, requester_limit, approver_limit, updated_by_user_id)
   values ($1, $2, 'auto_approve_to_limit', 500, null, $3)
   on conflict (tenant_id, user_id) do update set
     requester_mode = excluded.requester_mode, requester_limit = excluded.requester_limit`,
  [tenantId, userIds.planner, userIds.owner],
);
await c.query(
  `insert into tenant_member_requisition_authority
     (tenant_id, user_id, requester_mode, requester_limit, approver_limit, updated_by_user_id)
   values ($1, $2, 'always_require_approval', null, 5000, $3)
   on conflict (tenant_id, user_id) do update set approver_limit = excluded.approver_limit`,
  [tenantId, userIds.manager, userIds.owner],
);

// Catalog: SKU, name, stock UoM, on-hand Houston, on-hand Baton Rouge.
const CATALOG = [
  ['VLV-BALL-2', 'Ball valve 2 in. brass', 'each', 40, 15],
  ['PIP-PVC-10', 'PVC pipe 10 ft. sch 40', 'each', 120, 60],
  ['FLG-WN-4', 'Weld-neck flange 4 in.', 'each', 8, 2],
  ['GSK-SPRL-4', 'Spiral-wound gasket 4 in.', 'each', 200, 90],
  ['PMP-CENT-1', 'Centrifugal pump 1 HP', 'each', 5, 1],
  ['ROD-THRD-M10', 'Threaded rod M10 (3 ft.)', 'each', 65, 30],
];
const productIds = {};
for (const [sku, name, uom, hou, brg] of CATALOG) {
  const p = await c.query(
    `insert into products (tenant_id, sku, name, unit_of_measure, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (tenant_id, sku) do update set name = excluded.name returning id`,
    [tenantId, sku, name, uom],
  );
  productIds[sku] = p.rows[0].id;
  for (const [locId, qty] of [
    [houstonId, hou],
    [batonRougeId, brg],
  ]) {
    await c.query(
      `insert into inventory_levels (tenant_id, product_id, location_id, on_hand, avg_unit_cost)
       values ($1, $2, $3, $4, 20)
       on conflict (tenant_id, product_id, location_id) do update set on_hand = excluded.on_hand`,
      [tenantId, productIds[sku], locId, qty],
    );
  }
}

async function ensureSupplier(name) {
  const found = await c.query('select id from suppliers where tenant_id = $1 and name = $2', [
    tenantId,
    name,
  ]);
  if (found.rows[0]) return found.rows[0].id;
  const ins = await c.query(
    `insert into suppliers (tenant_id, name, default_lead_time_days, status)
     values ($1, $2, 7, 'active') returning id`,
    [tenantId, name],
  );
  return ins.rows[0].id;
}
const gulfId = await ensureSupplier('Gulf Coast Fasteners');
const bayouId = await ensureSupplier('Bayou Industrial Supply');

// Supplier links. GSK-SPRL-4 is case-packed (case of 24); FLG-WN-4 is the
// deliberately UoM-less link (null UoM + null factor) that exercises the
// round-4 conversion fix live.
const LINKS = [
  ['GSK-SPRL-4', gulfId, 'GCF-GSK4-CS', 48, 'case', 24],
  ['FLG-WN-4', bayouId, 'BIS-FLG4', 35, null, null],
  ['VLV-BALL-2', gulfId, 'GCF-VLV2', 22, null, null],
  ['PMP-CENT-1', bayouId, 'BIS-PMP1', 310, null, null],
];
for (const [sku, supId, supSku, cost, puom, factor] of LINKS) {
  await c.query(
    `insert into product_suppliers
       (tenant_id, product_id, supplier_id, supplier_sku, unit_cost, lead_time_days,
        is_primary, purchase_uom, purchase_to_stock_factor)
     values ($1, $2, $3, $4, $5, 7, true, $6, $7)
     on conflict (tenant_id, product_id, supplier_id) do update set
       unit_cost = excluded.unit_cost,
       purchase_uom = excluded.purchase_uom,
       purchase_to_stock_factor = excluded.purchase_to_stock_factor`,
    [tenantId, productIds[sku], supId, supSku, cost, puom, factor],
  );
}

// Promoted 30-day forecasts + daily points so /plan renders real coverage.
const FORECAST_DEMAND = [
  ['VLV-BALL-2', houstonId, 2.0],
  ['VLV-BALL-2', batonRougeId, 1.0],
  ['PIP-PVC-10', houstonId, 5.0],
  ['GSK-SPRL-4', houstonId, 8.0],
  ['GSK-SPRL-4', batonRougeId, 4.0],
  ['FLG-WN-4', batonRougeId, 0.6],
  ['ROD-THRD-M10', houstonId, 3.0],
];
for (const [sku, locId, dailyMean] of FORECAST_DEMAND) {
  const existing = await c.query(
    `select id from forecasts where tenant_id = $1 and product_id = $2 and location_id = $3 and promoted`,
    [tenantId, productIds[sku], locId],
  );
  if (existing.rows[0]) continue;
  const f = await c.query(
    `insert into forecasts
       (tenant_id, product_id, location_id, aggregation_level, method, horizon_days,
        confidence_level, promoted, run_id, computed_at)
     values ($1, $2, $3, 'sku_location', 'seasonal_naive', 30, 0.9, true, gen_random_uuid(), now())
     returning id`,
    [tenantId, productIds[sku], locId],
  );
  for (let d = 0; d < 30; d++) {
    await c.query(
      `insert into forecast_points (tenant_id, forecast_id, period_date, mean)
       values ($1, $2, current_date + $3::int, $4)`,
      [tenantId, f.rows[0].id, d, dailyMean],
    );
  }
}

// One in-transit PO (confirmed incoming on /plan): 2 cases of gaskets to Houston,
// approved through the real kernel seam with its converted-requisition evidence.
let po = await c.query(
  `select id, requisition_id from purchase_orders
   where tenant_id = $1 and external_reference = 'W3KIT-PO-1' limit 1`,
  [tenantId],
);
if (!po.rows[0]) {
  po = await c.query(
    `insert into purchase_orders
       (tenant_id, supplier_id, location_id, status, recommended_by, created_by_user_id,
        total, expected_delivery_at, external_reference)
     values ($1, $2, $3, 'draft', 'user', $4, 96, now() + interval '7 days', 'W3KIT-PO-1')
     returning id, requisition_id`,
    [tenantId, gulfId, houstonId, userIds.owner],
  );
}
const poId = po.rows[0].id;
if (!po.rows[0].requisition_id) {
  const approval = await c.query(
    `insert into requisitions
       (tenant_id, location_id, status, requested_by_user_id, decided_at, total,
        approval_reason, approval_policy_snapshot)
     values ($1, $2, 'converted', $3, now(), 96,
             'unlimited_requester_authority', '{"w3_testkit":true}'::jsonb)
     returning id`,
    [tenantId, houstonId, userIds.owner],
  );
  await c.query(`update purchase_orders set requisition_id = $1 where tenant_id = $2 and id = $3`, [
    approval.rows[0].id,
    tenantId,
    poId,
  ]);
  await c.query(
    `insert into purchase_order_lines
       (tenant_id, po_id, line_no, product_id, recommended_qty, ordered_qty, received_qty,
        unit_cost, purchase_uom, purchase_to_stock_factor)
     values ($1, $2, 1, $3, 2, 2, 0, 48, 'case', 24)
     on conflict (po_id, line_no) do nothing`,
    [tenantId, poId, productIds['GSK-SPRL-4']],
  );
  await c.query(`select * from apply_po_approval($1, $2, 'sent', null, 'W3KIT-PO-1', null)`, [
    tenantId,
    poId,
  ]);
}

// Open reorder recommendations: the UoM-less flange (round-4 fix path) and the
// low pump. Direct seed so the "Submit purchase request" CTA is one click away.
const RECS = [
  ['FLG-WN-4', batonRougeId, bayouId, 10],
  ['PMP-CENT-1', batonRougeId, bayouId, 2],
];
for (const [sku, locId, supId, qty] of RECS) {
  const existing = await c.query(
    `select id from reorder_recommendations
     where tenant_id = $1 and product_id = $2 and location_id = $3 and status = 'open'`,
    [tenantId, productIds[sku], locId],
  );
  if (existing.rows[0]) continue;
  await c.query(
    `insert into reorder_recommendations
       (tenant_id, product_id, location_id, supplier_id, recommended_qty, reason, source, status)
     values ($1, $2, $3, $4, $5, '{"note":"below reorder point (test kit)"}'::jsonb, 'system', 'open')`,
    [tenantId, productIds[sku], locId, supId, qty],
  );
}

console.log(
  JSON.stringify(
    {
      tenantId,
      locations: { houstonId, batonRougeId },
      users: Object.fromEntries(USERS.map(([email, , role]) => [role, email])),
      openRecommendations: RECS.map(([sku]) => sku),
      inTransitPo: 'W3KIT-PO-1',
    },
    null,
    2,
  ),
);
await c.end();
