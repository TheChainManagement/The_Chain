import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'b4444444-4444-4444-4444-444444444444';
const U = 'b4000000-0000-0000-0000-000000000044';
let client: Client;
let productId: string;
let sourceId: string;
let destinationId: string;

async function errorOf(sql: string, params: unknown[]): Promise<string> {
  await client.query('savepoint transfer_error');
  try {
    await client.query(sql, params);
    return '';
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.query('rollback to savepoint transfer_error');
  }
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'transfer');
  const seeded = await client.query<{ product_id: string; location_id: string }>(
    'select product_id, location_id from inventory_levels where tenant_id = $1 limit 1',
    [T],
  );
  productId = seeded.rows[0]?.product_id ?? '';
  sourceId = seeded.rows[0]?.location_id ?? '';
  const destination = await client.query<{ id: string }>(
    `insert into locations (tenant_id, name, type) values ($1, 'North', 'warehouse') returning id`,
    [T],
  );
  destinationId = destination.rows[0]?.id ?? '';
  await client.query(
    `insert into inventory_levels
       (tenant_id, product_id, location_id, on_hand, avg_unit_cost, avg_cost_provenance)
     values ($1, $2, $3, 10, 20, 'posted')`,
    [T, productId, destinationId],
  );
  await client.query(
    `update inventory_levels set avg_unit_cost = 10, avg_cost_provenance = 'posted'
     where tenant_id = $1 and product_id = $2 and location_id = $3`,
    [T, productId, sourceId],
  );
});

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('execute_stock_transfer', () => {
  it('posts matched OUT/IN atomically and preserves tenant quantity and value', async () => {
    const before = await client.query<{ qty: string; value: string }>(
      `select sum(on_hand) qty, sum(on_hand * avg_unit_cost) value
       from inventory_levels where tenant_id = $1 and product_id = $2`,
      [T, productId],
    );
    const result = await client.query<{ out_applied: boolean; out_transfer_id: string }>(
      'select * from execute_stock_transfer($1,$2,$3,$4,$5,$6,$7)',
      [T, productId, sourceId, destinationId, 20, 'transfer-1', U],
    );
    expect(result.rows[0]?.out_applied).toBe(true);

    const after = await client.query<{ qty: string; value: string }>(
      `select sum(on_hand) qty, sum(on_hand * avg_unit_cost) value
       from inventory_levels where tenant_id = $1 and product_id = $2`,
      [T, productId],
    );
    expect(Number(after.rows[0]?.qty)).toBe(Number(before.rows[0]?.qty));
    // avg_unit_cost is stored at four decimals, so valuation conservation is
    // asserted at the product's reporting precision (currency cents).
    expect(Number(after.rows[0]?.value)).toBeCloseTo(Number(before.rows[0]?.value), 2);
    const destination = await client.query<{ avg_unit_cost: string; avg_cost_provenance: string }>(
      `select avg_unit_cost, avg_cost_provenance from inventory_levels
       where tenant_id = $1 and product_id = $2 and location_id = $3`,
      [T, productId, destinationId],
    );
    expect(Number(destination.rows[0]?.avg_unit_cost)).toBeCloseTo(40 / 3, 4);
    expect(destination.rows[0]?.avg_cost_provenance).toBe('posted');
    const movements = await client.query<{ type: string; quantity: string; source_ref: string }>(
      `select type, quantity, source_ref from stock_movements
       where tenant_id = $1 and source_ref like $2 order by occurred_at`,
      [T, `transfer:${result.rows[0]?.out_transfer_id}%`],
    );
    expect(movements.rows.map((row) => [row.type, Number(row.quantity)])).toEqual([
      ['transfer_out', -20],
      ['transfer_in', 20],
    ]);
    const event = await client.query<{ actor_user_id: string }>(
      'select actor_user_id from stock_transfer_events where tenant_id = $1 and id = $2',
      [T, result.rows[0]?.out_transfer_id],
    );
    expect(event.rows[0]?.actor_user_id).toBe(U);
  });

  it('delegates destination valuation to the posting kernel', async () => {
    const definition = await client.query<{ definition: string }>(
      `select pg_get_functiondef(
         'execute_stock_transfer(uuid,uuid,uuid,uuid,numeric,text,uuid)'::regprocedure
       ) definition`,
    );
    expect(definition.rows[0]?.definition).not.toMatch(/update\s+public\.inventory_levels/i);
    expect(definition.rows[0]?.definition).toMatch(
      /post_stock_movement\([\s\S]*?'transfer_in'[\s\S]*?v_source\.avg_unit_cost/i,
    );
  });

  it('replaces the old definer overload with one SECURITY INVOKER function', async () => {
    const functions = await client.query<{ identity_args: string; security_definer: boolean }>(
      `select pg_get_function_identity_arguments(p.oid) identity_args,
              p.prosecdef security_definer
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'execute_stock_transfer'`,
    );
    expect(functions.rows).toHaveLength(1);
    expect(functions.rows[0]?.identity_args).toContain('p_actor uuid');
    expect(functions.rows[0]?.security_definer).toBe(false);
  });

  it('replays the same key without a second movement', async () => {
    const replay = await client.query<{ out_applied: boolean }>(
      'select * from execute_stock_transfer($1,$2,$3,$4,$5,$6,$7)',
      [T, productId, sourceId, destinationId, 20, 'transfer-1', U],
    );
    expect(replay.rows[0]?.out_applied).toBe(false);
    const count = await client.query<{ count: string }>(
      `select count(*) from stock_movements where tenant_id = $1
       and source_ref like 'transfer:%'`,
      [T],
    );
    expect(Number(count.rows[0]?.count)).toBe(2);
  });

  it('rejects same-location and excessive moves with zero partial writes', async () => {
    expect(
      await errorOf('select * from execute_stock_transfer($1,$2,$3,$4,$5,$6,$7)', [
        T,
        productId,
        sourceId,
        sourceId,
        1,
        'same',
        U,
      ]),
    ).toMatch(/same_location/i);
    const before = await client.query<{ count: string }>(
      'select count(*) from stock_transfer_events where tenant_id = $1',
      [T],
    );
    expect(
      await errorOf('select * from execute_stock_transfer($1,$2,$3,$4,$5,$6,$7)', [
        T,
        productId,
        sourceId,
        destinationId,
        10000,
        'too-much',
        U,
      ]),
    ).toMatch(/insufficient_transferable_stock/i);
    const after = await client.query<{ count: string }>(
      'select count(*) from stock_transfer_events where tenant_id = $1',
      [T],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
