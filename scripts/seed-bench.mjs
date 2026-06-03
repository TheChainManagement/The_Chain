#!/usr/bin/env node
/**
 * seed-bench.mjs — populate an isolated bench tenant with 5,000 active SKUs +
 * inventory so `bench:inventory` can measure the inventory_list_v query at the
 * acceptance scale. Runs as the local superuser (RLS bypassed) for setup only;
 * the bench itself queries through the authenticated/RLS path.
 *
 * Idempotent: re-running tops the bench tenant back up to SKU_COUNT. Kept out of
 * the demo tenant so the UI catalog stays clean. Local-only fixture.
 *
 * Usage: node scripts/seed-bench.mjs   (DB via SUPABASE_DB_URL or local default)
 */
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

const SKU_COUNT = Number(process.env.SEED_SKUS ?? 5000);
const SLUG = 'bench-5k';
const EMAIL = 'bench-5k@thechain.test';

function dbUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const m = env.match(/^SUPABASE_DB_URL=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

const c = new Client({ connectionString: dbUrl() });
await c.connect();
try {
  // Tenant + owner user + membership (idempotent).
  const t = await c.query(
    `insert into tenants (name, slug) values ('Bench 5k', $1)
       on conflict (slug) do update set name = excluded.name returning id`,
    [SLUG],
  );
  const tenantId = t.rows[0].id;

  // auth.users.email is a PARTIAL unique index (where is_sso_user=false), which
  // on conflict can't infer — so select-then-insert.
  const existing = await c.query('select id from auth.users where email = $1', [EMAIL]);
  const userId = existing.rowCount
    ? existing.rows[0].id
    : (
        await c.query(
          `insert into auth.users (id, instance_id, email)
             values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1) returning id`,
          [EMAIL],
        )
      ).rows[0].id;

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

  // One location.
  const loc = await c.query(
    `insert into locations (tenant_id, name, type) values ($1, 'Bench DC', 'warehouse')
       on conflict do nothing returning id`,
    [tenantId],
  );
  const locationId =
    loc.rows[0]?.id ??
    (await c.query(`select id from locations where tenant_id = $1 limit 1`, [tenantId])).rows[0].id;

  // 5k products via generate_series (fast, set-based). Varied SKUs/names so the
  // ilike search path is exercised; quantities spread across a plausible range.
  await c.query(
    `insert into products (tenant_id, sku, name, unit_of_measure, status)
       select $1,
              'BMK-' || lpad(g::text, 5, '0'),
              'Bench part ' || g || ' (' || (array['elbow','coupling','nipple','flange','gasket','valve','union','bushing'])[1 + (g % 8)] || ')',
              (array['each','case','box','ft'])[1 + (g % 4)],
              'active'
       from generate_series(1, $2) g
       on conflict (tenant_id, sku) do nothing`,
    [tenantId, SKU_COUNT],
  );

  await c.query(
    `insert into inventory_levels (tenant_id, product_id, location_id, on_hand, allocated, in_transit)
       select p.tenant_id, p.id, $2,
              ((p.sku ~ '[0-9]+$')::int * ((('x' || substr(md5(p.sku), 1, 4))::bit(16)::int % 900) + 12))::numeric(14,2),
              0, 0
       from products p
       where p.tenant_id = $1 and p.sku like 'BMK-%'
       on conflict (tenant_id, product_id, location_id) do nothing`,
    [tenantId, locationId],
  );

  const count = await c.query(
    `select count(*)::int n from products where tenant_id = $1 and status = 'active'`,
    [tenantId],
  );
  console.log(`Bench tenant ${tenantId} (user ${userId}) seeded: ${count.rows[0].n} active SKUs.`);
} finally {
  await c.end();
}
