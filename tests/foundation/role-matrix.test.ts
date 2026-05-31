import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * Role-matrix probe (FEATURES.md Foundation acceptance + the "multi-user +
 * role-based dashboards" wired-for dry run). One seeded tenant; we put on each
 * role via the JWT claim and assert the RLS matrix grants/denies exactly what
 * SYSTEM_DESIGN.md specifies. Denied SELECT returns 0 rows; denied UPDATE
 * affects 0 rows; denied INSERT raises a row-level-security violation.
 */

const T = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const U = 'c0000000-0000-0000-0000-0000000000cc';

let client: Client;

function as(role: string) {
  return actAs(client, { sub: U, tenant_id: T, role });
}

async function updateCount(table: string): Promise<number> {
  // No-op update scoped to the tenant; RLS USING decides how many rows update.
  const res = await client.query(
    `update public.${table} set tenant_id = tenant_id where tenant_id = $1`,
    [T],
  );
  return res.rowCount ?? 0;
}

async function selectCount(table: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where tenant_id = $1`,
    [T],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'c');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('role matrix — finance', () => {
  it('CAN select subscriptions and audit_log', async () => {
    await as('finance');
    expect(await selectCount('subscriptions')).toBeGreaterThan(0);
    expect(await selectCount('audit_log')).toBeGreaterThan(0);
  });

  it('CANNOT update products', async () => {
    await as('finance');
    expect(await updateCount('products')).toBe(0);
  });
});

describe('role matrix — planner', () => {
  it('CAN update reorder_recommendations and purchase_orders', async () => {
    await as('planner');
    expect(await updateCount('reorder_recommendations')).toBeGreaterThan(0);
    expect(await updateCount('purchase_orders')).toBeGreaterThan(0);
  });

  it('CANNOT select subscriptions', async () => {
    await as('planner');
    expect(await selectCount('subscriptions')).toBe(0);
  });
});

describe('role matrix — viewer', () => {
  it('CAN select products but CANNOT mutate', async () => {
    await as('viewer');
    expect(await selectCount('products')).toBeGreaterThan(0);
    expect(await updateCount('purchase_orders')).toBe(0);
  });

  it('INSERT into products is rejected by RLS', async () => {
    await as('viewer');
    // A failed statement aborts the transaction, so guard with a savepoint and
    // recover to it after the expected rejection.
    await client.query('savepoint viewer_insert');
    await expect(
      client.query(
        `insert into public.products (tenant_id, sku, name) values ($1, 'VIEWER-NOPE', 'Nope')`,
        [T],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.query('rollback to savepoint viewer_insert');
  });
});

describe('role matrix — warehouse', () => {
  it('CAN update inventory_levels but CANNOT update products', async () => {
    await as('warehouse');
    expect(await updateCount('inventory_levels')).toBeGreaterThan(0);
    expect(await updateCount('products')).toBe(0);
  });
});

describe('role matrix — owner', () => {
  it('CAN select subscriptions and update products', async () => {
    await as('owner');
    expect(await selectCount('subscriptions')).toBeGreaterThan(0);
    expect(await updateCount('products')).toBeGreaterThan(0);
  });
});
