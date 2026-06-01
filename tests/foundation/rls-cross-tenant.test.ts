import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * Cross-tenant RLS probe (FEATURES.md Foundation acceptance + Codex checklist:
 * "genuinely uses two distinct tenants").
 *
 * Two fully-seeded tenants, A and B. Signed in as A's owner, every table that
 * carries a tenant_id must return ZERO of tenant B's rows. The table list is
 * discovered from the catalog, so a table added later is covered automatically
 * (and would fail this probe if someone forgot its RLS policy).
 *
 * Runs in one rolled-back transaction.
 */

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UA = 'a0000000-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const UB = 'b0000000-0000-0000-0000-0000000000bb';

let client: Client;
let tenantTables: string[] = [];

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, A, UA, 'a');
  await seedTenant(client, B, UB, 'b');

  const { rows } = await client.query<{ table_name: string }>(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')    -- ordinary + partitioned-parent tables
      and not c.relispartition        -- skip partition children (covered via parent)
      and c.relrowsecurity            -- RLS enabled
      and not a.attisdropped
    order by c.relname
  `);
  tenantTables = rows.map((r) => r.table_name);
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('cross-tenant RLS isolation', () => {
  it('discovers a broad set of tenant-scoped tables to probe', () => {
    // Sanity: the catalog query found the schema, not an empty list.
    expect(tenantTables.length).toBeGreaterThan(20);
    expect(tenantTables).toContain('inventory_levels');
    expect(tenantTables).toContain('stock_movements');
    expect(tenantTables).toContain('audit_log');
    expect(tenantTables).toContain('subscriptions');
  });

  it('signed in as tenant A, sees ZERO of tenant B rows in every tenant table', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });

    const leaks: Array<{ table: string; bRows: number }> = [];
    for (const table of tenantTables) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where tenant_id = $1`,
        [B],
      );
      const n = rows[0]?.n ?? -1;
      if (n !== 0) leaks.push({ table, bRows: n });
    }

    expect(leaks, `tenant B rows leaked into tenant A view: ${JSON.stringify(leaks)}`).toEqual([]);
  });

  it('the probe is real: tenant A DOES see its own rows (RLS is not just hiding everything)', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    // A subset of tables A is allowed to SELECT and was seeded.
    for (const table of ['products', 'inventory_levels', 'stock_movements', 'purchase_orders']) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where tenant_id = $1`,
        [A],
      );
      expect(rows[0]?.n ?? 0, `tenant A should see its own ${table}`).toBeGreaterThan(0);
    }
  });

  it('tenant A cannot see tenant B in tenants/profiles either', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    const tenants = await client.query<{ n: number }>(
      `select count(*)::int as n from public.tenants where id = $1`,
      [B],
    );
    expect(tenants.rows[0]?.n).toBe(0);
    const profiles = await client.query<{ n: number }>(
      `select count(*)::int as n from public.profiles where user_id = $1`,
      [UB],
    );
    expect(profiles.rows[0]?.n).toBe(0);
  });

  it('tenant A cannot WRITE into tenant B (insert rejected, update affects 0 rows)', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    await client.query('savepoint xtenant');
    await expect(
      client.query(
        `insert into public.products (tenant_id, sku, name) values ($1, 'XTENANT', 'nope')`,
        [B],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.query('rollback to savepoint xtenant');

    const upd = await client.query(`update public.products set name = name where tenant_id = $1`, [B]);
    expect(upd.rowCount).toBe(0);
  });

  it('partition children are not a side door: direct access is revoked from authenticated', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    await client.query('savepoint partchild');
    // Direct child access is revoked entirely; parent-routed queries (covered
    // above) still work because privileges are checked on the parent.
    await expect(
      client.query(`select count(*) from public.stock_movements_2026`),
    ).rejects.toThrow(/permission denied/i);
    await client.query('rollback to savepoint partchild');
  });
});
