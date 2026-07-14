import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'a4444444-4444-4444-4444-444444444444';
const U = 'a4000000-0000-0000-0000-000000000044';
let client: Client;

async function dbError(sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint location_error');
  try {
    await client.query(sql, params);
    return '';
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.query('rollback to savepoint location_error');
  }
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'w2-4');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('W2-4a location lifecycle', () => {
  it('backfills exactly one active primary and defaults later locations to non-primary', async () => {
    await asSuperuser(client);
    const before = await client.query<{ count: string }>(
      'select count(*) from locations where tenant_id = $1 and is_primary and active',
      [T],
    );
    expect(Number(before.rows[0]?.count)).toBe(1);

    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    const added = await client.query<{ id: string; is_primary: boolean }>(
      `insert into locations (tenant_id, name, type)
       values ($1, 'North warehouse', 'warehouse') returning id, is_primary`,
      [T],
    );
    expect(added.rows[0]?.is_primary).toBe(false);
  });

  it('moves the primary marker atomically and rejects planner execution', async () => {
    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    const added = await client.query<{ id: string }>(
      `insert into locations (tenant_id, name, type)
       values ($1, 'South warehouse', 'warehouse') returning id`,
      [T],
    );
    const id = added.rows[0]?.id;
    await client.query('select set_primary_location($1, $2)', [T, id]);
    const primary = await client.query<{ id: string }>(
      'select id from locations where tenant_id = $1 and is_primary',
      [T],
    );
    expect(primary.rows).toEqual([{ id }]);

    await actAs(client, { sub: U, tenant_id: T, role: 'planner' });
    expect(await dbError('select set_primary_location($1, $2)', [T, id])).toMatch(/not authorized/i);
  });

  it('blocks duplicate active names and unsafe archival at the database boundary', async () => {
    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    await client.query(
      `insert into locations (tenant_id, name, type) values ($1, 'Overflow', 'warehouse')`,
      [T],
    );
    expect(
      await dbError(
        `insert into locations (tenant_id, name, type) values ($1, ' overflow ', 'store')`,
        [T],
      ),
    ).toMatch(/locations_active_name_unique/i);

    const original = await client.query<{ id: string }>(
      `select l.id from locations l
       join inventory_levels il on il.tenant_id = l.tenant_id and il.location_id = l.id
       where l.tenant_id = $1 and il.on_hand <> 0 limit 1`,
      [T],
    );
    expect(
      await dbError('update locations set active = false where tenant_id = $1 and id = $2', [
        T,
        original.rows[0]?.id,
      ]),
    ).toMatch(/primary|non-zero inventory/i);
  });

  it('keeps cross-tenant primary targets outside the callable boundary', async () => {
    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    expect(
      await dbError('select set_primary_location($1, $2)', [
        T,
        '00000000-0000-0000-0000-000000000099',
      ]),
    ).toMatch(/not found/i);
  });
});
