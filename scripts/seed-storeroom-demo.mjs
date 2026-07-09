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

console.log(JSON.stringify({ tenantId, userId, locationId, email: EMAIL, skus: SHELF.length }));
await c.end();
