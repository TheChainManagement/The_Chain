// W2-2 walkthrough fixture: a storeroom-mode tenant with an MRO shelf.
// Local-only fixture (like seed-bench.mjs). Sign in: mg-store@local.test / StoreroomDemo1
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

const EMAIL = 'mg-store@local.test';
const PASSWORD = 'StoreroomDemo1';

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
await c.connect();

// Auth user (idempotent).
let userId;
const existing = await c.query('select id from auth.users where email = $1', [EMAIL]);
if (existing.rows[0]) {
  userId = existing.rows[0].id;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
}

// Tenant graph (idempotent on slug).
const t = await c.query(
  `insert into tenants (name, slug, operating_mode) values ('Bayou Maintenance Co', 'bayou-maintenance', 'storeroom')
   on conflict (slug) do update set operating_mode = 'storeroom' returning id`,
);
const tenantId = t.rows[0].id;

await c.query(
  `insert into profiles (user_id, active_tenant_id) values ($1, $2)
   on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id`,
  [userId, tenantId],
);
await c.query(
  `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')
   on conflict (tenant_id, user_id) do nothing`,
  [tenantId, userId],
);
await c.query(
  `insert into subscriptions (tenant_id, status, trial_start, trial_end, plan_code, retention_tier)
   values ($1, 'active', now(), now() + interval '1 year', 'growth', 'standard')
   on conflict (tenant_id) do update set status = 'active'`,
  [tenantId],
);

const loc = await c.query(
  `insert into locations (tenant_id, name, type, location_kind)
   select $1, 'Central Storeroom', 'warehouse', 'stockroom'
   where not exists (select 1 from locations where tenant_id = $1)
   returning id`,
  [tenantId],
);
const locationId =
  loc.rows[0]?.id ??
  (await c.query('select id from locations where tenant_id = $1 limit 1', [tenantId])).rows[0].id;

const SHELF = [
  ['BRG-6204', 'Ball bearing 6204-2RS', 'each', 48],
  ['SEAL-PMP-3', 'Pump seal kit 3 in.', 'each', 12],
  ['GLV-NTR-L', 'Nitrile gloves, large (box)', 'box', 35],
  ['FLT-HYD-10', 'Hydraulic filter 10 micron', 'each', 22],
  ['GRS-EP2', 'EP2 lithium grease cartridge', 'each', 60],
  ['BLT-M12-50', 'Hex bolt M12x50 zinc (bag of 25)', 'bag', 18],
];

for (const [sku, name, uom, onHand] of SHELF) {
  const p = await c.query(
    `insert into products (tenant_id, sku, name, unit_of_measure, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (tenant_id, sku) do update set name = excluded.name
     returning id`,
    [tenantId, sku, name, uom],
  );
  await c.query(
    `insert into inventory_levels (tenant_id, product_id, location_id, on_hand)
     values ($1, $2, $3, $4)
     on conflict (tenant_id, product_id, location_id) do update set on_hand = excluded.on_hand`,
    [tenantId, p.rows[0].id, locationId, onHand],
  );
}

// Walkthrough PO: four cases of bearings, 12 each per case. Approve it through
// the real kernel surface so the PO detail shows both the purchase-UoM receive
// conversion rail and the matching stock-UoM in-transit quantity.
const bearing = await c.query(
  `select id from products where tenant_id = $1 and sku = 'BRG-6204'`,
  [tenantId],
);
const productId = bearing.rows[0].id;
let supplier = await c.query(
  `select id from suppliers where tenant_id = $1 and name = 'Gulf Bearing Supply' limit 1`,
  [tenantId],
);
if (!supplier.rows[0]) {
  supplier = await c.query(
    `insert into suppliers (tenant_id, name, default_lead_time_days, status)
     values ($1, 'Gulf Bearing Supply', 7, 'active') returning id`,
    [tenantId],
  );
}
const supplierId = supplier.rows[0].id;
await c.query(
  `insert into product_suppliers
     (tenant_id, product_id, supplier_id, supplier_sku, unit_cost, lead_time_days,
      is_primary, purchase_uom, purchase_to_stock_factor)
   values ($1, $2, $3, 'GBS-6204-CS', 120, 7, true, 'case', 12)
   on conflict (tenant_id, product_id, supplier_id) do update set
     supplier_sku = excluded.supplier_sku,
     unit_cost = excluded.unit_cost,
     lead_time_days = excluded.lead_time_days,
     is_primary = excluded.is_primary,
     purchase_uom = excluded.purchase_uom,
     purchase_to_stock_factor = excluded.purchase_to_stock_factor`,
  [tenantId, productId, supplierId],
);

let purchaseOrder = await c.query(
  `select id, status from purchase_orders
   where tenant_id = $1 and external_reference = 'DEMO-CASE-PO' limit 1`,
  [tenantId],
);
if (!purchaseOrder.rows[0]) {
  purchaseOrder = await c.query(
    `insert into purchase_orders
       (tenant_id, supplier_id, location_id, status, recommended_by, created_by_user_id,
        total, expected_delivery_at, external_reference)
     values ($1, $2, $3, 'draft', 'user', $4, 480, now() + interval '7 days',
             'DEMO-CASE-PO')
     returning id, status`,
    [tenantId, supplierId, locationId, userId],
  );
}
const poId = purchaseOrder.rows[0].id;
await c.query(
  `insert into purchase_order_lines
     (tenant_id, po_id, line_no, product_id, recommended_qty, ordered_qty, received_qty,
      unit_cost, purchase_uom, purchase_to_stock_factor)
   values ($1, $2, 1, $3, 4, 4, 0, 120, 'case', 12)
   on conflict (po_id, line_no) do update set
     ordered_qty = excluded.ordered_qty,
     unit_cost = excluded.unit_cost,
     purchase_uom = excluded.purchase_uom,
     purchase_to_stock_factor = excluded.purchase_to_stock_factor`,
  [tenantId, poId, productId],
);
await c.query(
  `select * from apply_po_approval($1, $2, 'sent', null, 'DEMO-CASE-PO', null)`,
  [tenantId, poId],
);

console.log(
  JSON.stringify({
    tenantId,
    userId,
    locationId,
    email: EMAIL,
    skus: SHELF.length,
    casePackedPoId: poId,
  }),
);
await c.end();
