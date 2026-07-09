import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * W2-2 storeroom DB layer: the enum completion, the §10 validation CHECKs, and
 * the three operator posting RPCs (issue / adjustment / cycle-count close).
 * Runs against the real local schema in one rolled-back transaction, superuser
 * (the RPCs are service-role-called in production; the action gate authorizes).
 * Error paths run inside savepoints so a raised exception doesn't poison the
 * enclosing transaction.
 */

const T = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const U = 'c0000000-0000-0000-0000-0000000000cc';

let client: Client;
let productId: string;
let locationId: string;
let sessionId: string;

async function expectDbError(sql: string, params: unknown[], code: string): Promise<void> {
  await client.query('savepoint sp_err');
  let message = '';
  try {
    await client.query(sql, params);
  } catch (e) {
    message = (e as Error).message;
  } finally {
    await client.query('rollback to savepoint sp_err');
  }
  expect(message).toContain(code);
}

async function onHand(): Promise<number> {
  const { rows } = await client.query(
    `select on_hand from inventory_levels
     where tenant_id = $1 and product_id = $2 and location_id = $3`,
    [T, productId, locationId],
  );
  return Number(rows[0]?.on_hand ?? Number.NaN);
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'sr');
  const { rows: prod } = await client.query(
    `select id from products where tenant_id = $1 limit 1`,
    [T],
  );
  const { rows: loc } = await client.query(
    `select id from locations where tenant_id = $1 limit 1`,
    [T],
  );
  const { rows: sess } = await client.query(
    `select id from cycle_count_sessions where tenant_id = $1 limit 1`,
    [T],
  );
  productId = prod[0].id;
  locationId = loc[0].id;
  sessionId = sess[0].id;
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('movement enum + validation CHECKs', () => {
  it('carries the four new movement types', async () => {
    const { rows } = await client.query(
      `select unnest(enum_range(null::stock_movement_type))::text as v`,
    );
    const values = rows.map((r) => r.v);
    for (const v of ['issue_out', 'issue_return', 'return_to_vendor', 'customer_return']) {
      expect(values).toContain(v);
    }
  });

  it('rejects an issue_out with a positive quantity or a missing demand ref', async () => {
    await expectDbError(
      `insert into stock_movements
         (tenant_id, product_id, location_id, type, quantity, source, occurred_at,
          demand_ref_type, demand_ref_id)
       values ($1, $2, $3, 'issue_out', 5, 'manual', now(), 'work_order', 'WO-1')`,
      [T, productId, locationId],
      'stock_movements_issue_out_check',
    );
    await expectDbError(
      `insert into stock_movements
         (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
       values ($1, $2, $3, 'issue_out', -5, 'manual', now())`,
      [T, productId, locationId],
      'stock_movements_issue_out_check',
    );
  });

  it('rejects a demand_ref_type outside the locked set', async () => {
    await expectDbError(
      `insert into stock_movements
         (tenant_id, product_id, location_id, type, quantity, source, occurred_at,
          demand_ref_type, demand_ref_id)
       values ($1, $2, $3, 'issue_out', -5, 'manual', now(), 'patient', 'P-1')`,
      [T, productId, locationId],
      'stock_movements_demand_ref_type_check',
    );
  });

  it('enforces return signs (vendor return leaves, customer return re-enters)', async () => {
    await expectDbError(
      `insert into stock_movements
         (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
       values ($1, $2, $3, 'return_to_vendor', 5, 'manual', now())`,
      [T, productId, locationId],
      'stock_movements_return_to_vendor_check',
    );
    await expectDbError(
      `insert into stock_movements
         (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
       values ($1, $2, $3, 'customer_return', -5, 'manual', now())`,
      [T, productId, locationId],
      'stock_movements_customer_return_check',
    );
  });
});

describe('post_issue_movements', () => {
  it('posts a tagged negative movement, moves on_hand, records the op event', async () => {
    const before = await onHand(); // seeded at 100
    const { rows } = await client.query(
      `select * from post_issue_movements($1, $2, 'issue_out', 'work_order', 'WO-10482',
         'maintenance', 'pump seal kit', $3::jsonb, $4, 'issue-key-1')`,
      [T, locationId, JSON.stringify([{ product_id: productId, qty: 3 }]), U],
    );
    expect(rows[0].out_applied).toBe(true);
    expect(Number(rows[0].out_lines)).toBe(1);
    expect(Number(rows[0].out_total_qty)).toBe(3);
    expect(await onHand()).toBe(before - 3);

    const { rows: mv } = await client.query(
      `select quantity, demand_ref_type, demand_ref_id, reason_code, note, source
       from stock_movements
       where tenant_id = $1 and type = 'issue_out'`,
      [T],
    );
    expect(mv).toHaveLength(1);
    expect(Number(mv[0].quantity)).toBe(-3);
    expect(mv[0].demand_ref_type).toBe('work_order');
    expect(mv[0].demand_ref_id).toBe('WO-10482');
    expect(mv[0].reason_code).toBe('maintenance');
    expect(mv[0].note).toBe('pump seal kit');
    expect(mv[0].source).toBe('manual');

    const { rows: ev } = await client.query(
      `select kind, actor_user_id, summary from inventory_op_events
       where tenant_id = $1 and idempotency_key = 'issue-key-1'`,
      [T],
    );
    expect(ev[0].kind).toBe('issue');
    expect(ev[0].actor_user_id).toBe(U);
    expect(ev[0].summary.demand_ref_id).toBe('WO-10482');
  });

  it('replays the same key as a no-op', async () => {
    const before = await onHand();
    const { rows } = await client.query(
      `select * from post_issue_movements($1, $2, 'issue_out', 'work_order', 'WO-10482',
         null, null, $3::jsonb, $4, 'issue-key-1')`,
      [T, locationId, JSON.stringify([{ product_id: productId, qty: 3 }]), U],
    );
    expect(rows[0].out_applied).toBe(false);
    expect(await onHand()).toBe(before);
  });

  it('takes unused material back with issue_return on the same ref', async () => {
    const before = await onHand();
    await client.query(
      `select * from post_issue_movements($1, $2, 'issue_return', 'work_order', 'WO-10482',
         'unused_material', null, $3::jsonb, $4, 'return-key-1')`,
      [T, locationId, JSON.stringify([{ product_id: productId, qty: 2 }]), U],
    );
    expect(await onHand()).toBe(before + 2);
    const { rows } = await client.query(
      `select quantity from stock_movements where tenant_id = $1 and type = 'issue_return'`,
      [T],
    );
    expect(Number(rows[0].quantity)).toBe(2);
  });

  it('refuses a bad ref type, blank ref, empty lines, and non-positive qty', async () => {
    const lines = JSON.stringify([{ product_id: productId, qty: 1 }]);
    await expectDbError(
      `select * from post_issue_movements($1, $2, 'issue_out', 'patient', 'P-1', null, null, $3::jsonb, $4, 'k-bad-1')`,
      [T, locationId, lines, U],
      'bad_demand_ref_type',
    );
    await expectDbError(
      `select * from post_issue_movements($1, $2, 'issue_out', 'crew', '  ', null, null, $3::jsonb, $4, 'k-bad-2')`,
      [T, locationId, lines, U],
      'missing_demand_ref',
    );
    await expectDbError(
      `select * from post_issue_movements($1, $2, 'issue_out', 'crew', 'C-9', null, null, '[]'::jsonb, $3, 'k-bad-3')`,
      [T, locationId, U],
      'no_lines',
    );
    await expectDbError(
      `select * from post_issue_movements($1, $2, 'issue_out', 'crew', 'C-9', null, null, $3::jsonb, $4, 'k-bad-4')`,
      [T, locationId, JSON.stringify([{ product_id: productId, qty: 0 }]), U],
      'bad_qty',
    );
  });
});

describe('post_stock_adjustment', () => {
  it('applies a signed correction with a required reason', async () => {
    const before = await onHand();
    const { rows } = await client.query(
      `select * from post_stock_adjustment($1, $2, $3, -4, 'damage', 'dropped pallet', $4, 'adj-key-1')`,
      [T, locationId, productId, U],
    );
    expect(rows[0].out_applied).toBe(true);
    expect(Number(rows[0].out_on_hand)).toBe(before - 4);
    expect(await onHand()).toBe(before - 4);

    const { rows: mv } = await client.query(
      `select quantity, reason_code, note from stock_movements
       where tenant_id = $1 and type = 'adjustment' and reason_code = 'damage'`,
      [T],
    );
    expect(Number(mv[0].quantity)).toBe(-4);
    expect(mv[0].note).toBe('dropped pallet');
  });

  it('refuses zero deltas and missing reasons; replays as a no-op', async () => {
    await expectDbError(
      `select * from post_stock_adjustment($1, $2, $3, 0, 'damage', null, $4, 'adj-bad-1')`,
      [T, locationId, productId, U],
      'bad_qty',
    );
    await expectDbError(
      `select * from post_stock_adjustment($1, $2, $3, 2, '  ', null, $4, 'adj-bad-2')`,
      [T, locationId, productId, U],
      'missing_reason',
    );
    const before = await onHand();
    const { rows } = await client.query(
      `select * from post_stock_adjustment($1, $2, $3, -4, 'damage', null, $4, 'adj-key-1')`,
      [T, locationId, productId, U],
    );
    expect(rows[0].out_applied).toBe(false);
    expect(await onHand()).toBe(before);
  });
});

describe('close_cycle_count_session', () => {
  it('reconciles counted lines to on_hand at close, posts the delta, completes', async () => {
    // Seeded line: expected 100, counted 98. on_hand has drifted through the
    // tests above — the close must reconcile against on_hand AT CLOSE.
    const before = await onHand();
    const { rows } = await client.query(
      `select * from close_cycle_count_session($1, $2, $3, 'count-key-1')`,
      [T, sessionId, U],
    );
    expect(rows[0].out_applied).toBe(true);
    expect(Number(rows[0].out_lines)).toBe(1);
    expect(Number(rows[0].out_movements)).toBe(1);
    expect(Number(rows[0].out_abs_variance)).toBe(Math.abs(98 - before));
    expect(await onHand()).toBe(98);

    const { rows: mv } = await client.query(
      `select quantity, reason_code from stock_movements
       where tenant_id = $1 and type = 'cycle_count'`,
      [T],
    );
    expect(Number(mv[0].quantity)).toBe(98 - before);
    expect(mv[0].reason_code).toBe('count_variance');

    const { rows: line } = await client.query(
      `select variance, counted_at from cycle_count_lines
       where tenant_id = $1 and session_id = $2`,
      [T, sessionId],
    );
    expect(Number(line[0].variance)).toBe(98 - 100); // report variance vs expected
    expect(line[0].counted_at).not.toBeNull();

    const { rows: sess } = await client.query(
      `select status, completed_at from cycle_count_sessions where id = $1`,
      [sessionId],
    );
    expect(sess[0].status).toBe('completed');
    expect(sess[0].completed_at).not.toBeNull();

    const { rows: lvl } = await client.query(
      `select last_counted_at from inventory_levels
       where tenant_id = $1 and product_id = $2 and location_id = $3`,
      [T, productId, locationId],
    );
    expect(lvl[0].last_counted_at).not.toBeNull();
  });

  it('refuses to close twice or to close a session with nothing counted', async () => {
    await expectDbError(
      `select * from close_cycle_count_session($1, $2, $3, 'count-key-2')`,
      [T, sessionId, U],
      'session_terminal',
    );

    const { rows: fresh } = await client.query(
      `insert into cycle_count_sessions (tenant_id, location_id, created_by_user_id)
       values ($1, $2, $3) returning id`,
      [T, locationId, U],
    );
    await expectDbError(
      `select * from close_cycle_count_session($1, $2, $3, 'count-key-3')`,
      [T, fresh[0].id, U],
      'nothing_counted',
    );
  });

  it('creates the level row for a counted product with no prior level', async () => {
    // New product counted for the first time at this location: close must
    // create the level row and set on_hand to the counted quantity.
    const { rows: p2 } = await client.query(
      `insert into products (tenant_id, id, sku, name)
       values ($1, gen_random_uuid(), 'SKU-sr-2', 'Widget 2') returning id`,
      [T],
    );
    const { rows: s2 } = await client.query(
      `insert into cycle_count_sessions (tenant_id, location_id, created_by_user_id)
       values ($1, $2, $3) returning id`,
      [T, locationId, U],
    );
    await client.query(
      `insert into cycle_count_lines (tenant_id, session_id, product_id, expected_qty, counted_qty)
       values ($1, $2, $3, null, 7)`,
      [T, s2[0].id, p2[0].id],
    );
    const { rows } = await client.query(
      `select * from close_cycle_count_session($1, $2, $3, 'count-key-4')`,
      [T, s2[0].id, U],
    );
    expect(rows[0].out_applied).toBe(true);
    const { rows: lvl } = await client.query(
      `select on_hand from inventory_levels
       where tenant_id = $1 and product_id = $2 and location_id = $3`,
      [T, p2[0].id, locationId],
    );
    expect(Number(lvl[0].on_hand)).toBe(7);
  });
});
