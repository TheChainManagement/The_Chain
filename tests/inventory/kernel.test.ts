import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * W2-2.5 posting kernel: post_stock_movement (the single balance-mutation
 * primitive), the moving-average cost rule, the on_hold bucket, the
 * balance-neutral ingestion door, purchase-UoM conversion through
 * approve/receive/convert, the onboarding seed's ledger row, and the
 * ledger-replay acceptance ("replay equals stored balances").
 *
 * Runs against the real local schema in one rolled-back transaction,
 * superuser (kernel callers are service-role in production; the action gate
 * authorizes). Error paths run inside savepoints.
 */

const T = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const U = 'd0000000-0000-0000-0000-0000000000dd';

let client: Client;
let productId: string;
let locationId: string;
let supplierId: string;
let poId: string;

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

interface Level {
  on_hand: number;
  on_hold: number;
  in_transit: number;
  avg_unit_cost: number | null;
  avg_cost_provenance: string | null;
}

async function level(prod = productId, loc = locationId): Promise<Level> {
  const { rows } = await client.query(
    `select on_hand, on_hold, in_transit, avg_unit_cost, avg_cost_provenance
     from inventory_levels
     where tenant_id = $1 and product_id = $2 and location_id = $3`,
    [T, prod, loc],
  );
  const r = rows[0];
  return {
    on_hand: Number(r.on_hand),
    on_hold: Number(r.on_hold),
    in_transit: Number(r.in_transit),
    avg_unit_cost: r.avg_unit_cost == null ? null : Number(r.avg_unit_cost),
    avg_cost_provenance: r.avg_cost_provenance,
  };
}

/** Kernel call with the orchestration params defaulted. */
function post(
  args: Partial<{
    type: string;
    qty: number;
    unitCost: number | null;
    affectsInTransit: boolean;
    reason: string | null;
    ref: string;
    prod: string;
    loc: string;
  }>,
): Promise<unknown> {
  return client.query(
    `select * from post_stock_movement(
       p_tenant := $1, p_product := $2, p_location := $3, p_type := $4,
       p_quantity := $5, p_source := 'manual', p_source_ref := $6,
       p_occurred_at := now(), p_reason_code := $7, p_unit_cost := $8,
       p_affects_in_transit := $9)`,
    [
      T,
      args.prod ?? productId,
      args.loc ?? locationId,
      args.type ?? 'adjustment',
      args.qty ?? 1,
      args.ref ?? `k:${args.type}:${args.qty}:${Math.abs(args.unitCost ?? 0)}`,
      args.reason ?? null,
      args.unitCost ?? null,
      args.affectsInTransit ?? false,
    ],
  );
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'kn');
  const { rows: prod } = await client.query(
    `select id, primary_supplier_id from products where tenant_id = $1 limit 1`,
    [T],
  );
  productId = prod[0].id;
  supplierId = prod[0].primary_supplier_id;
  const { rows: loc } = await client.query(
    `select id from locations where tenant_id = $1 limit 1`,
    [T],
  );
  locationId = loc[0].id;
  const { rows: po } = await client.query(
    `select id from purchase_orders where tenant_id = $1 limit 1`,
    [T],
  );
  poId = po[0].id;
  const { rows: approval } = await client.query(
    `insert into requisitions
       (tenant_id, location_id, status, requested_by_user_id, approved_by_user_id,
        decided_at, total)
     values ($1, $2, 'converted', $3, $3, now(), 600)
     returning id`,
    [T, locationId, U],
  );
  await client.query(
    `update purchase_orders set requisition_id = $1
     where tenant_id = $2 and id = $3`,
    [approval[0].id, T, poId],
  );
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('post_stock_movement — the balance rules', () => {
  // Seed level: on_hand 100, allocated 10, in_transit 5, avg cost null.

  it('rejects a wrong-signed quantity for the movement type', async () => {
    await expectDbError(
      `select * from post_stock_movement(p_tenant := $1, p_product := $2, p_location := $3,
        p_type := 'receipt', p_quantity := -3, p_source := 'manual', p_source_ref := 'k:bad',
        p_occurred_at := now())`,
      [T, productId, locationId],
      'bad_sign',
    );
  });

  it('first costed receipt on a costless level takes the receipt cost, provenance posted', async () => {
    await post({ type: 'receipt', qty: 50, unitCost: 2.0, ref: 'k:r1' });
    const l = await level();
    expect(l.on_hand).toBe(150);
    expect(l.avg_unit_cost).toBe(2.0);
    expect(l.avg_cost_provenance).toBe('posted');
  });

  it('second costed receipt moves the weighted average', async () => {
    // ((150 × 2.00) + (50 × 4.00)) / 200 = 2.50
    await post({ type: 'receipt', qty: 50, unitCost: 4.0, ref: 'k:r2' });
    const l = await level();
    expect(l.on_hand).toBe(200);
    expect(l.avg_unit_cost).toBe(2.5);
  });

  it('an uncosted movement leaves the average untouched', async () => {
    await post({ type: 'adjustment', qty: -37, reason: 'shrinkage', ref: 'k:a1' });
    const l = await level();
    expect(l.on_hand).toBe(163);
    expect(l.avg_unit_cost).toBe(2.5);
  });

  it('receipt with p_affects_in_transit floors in_transit at zero', async () => {
    // in_transit seeded at 5; the two receipts above did not touch it.
    await post({ type: 'receipt', qty: 12, unitCost: 2.5, affectsInTransit: true, ref: 'k:r3' });
    const l = await level();
    expect(l.in_transit).toBe(0);
    expect(l.on_hand).toBe(175);
  });

  it('a receipt onto negative stock resets the average to the receipt cost', async () => {
    await post({ type: 'adjustment', qty: -180, reason: 'writeoff', ref: 'k:a2' }); // → -5
    await post({ type: 'receipt', qty: 20, unitCost: 3.0, ref: 'k:r4' });
    const l = await level();
    expect(l.on_hand).toBe(15);
    expect(l.avg_unit_cost).toBe(3.0);
  });
});

describe('post_stock_movement — the on_hold bucket', () => {
  // Entering with on_hand 15, on_hold 0.

  it('hold moves quantity into on_hold without touching on_hand', async () => {
    await post({ type: 'hold', qty: 10, reason: 'qc_hold', ref: 'k:h1' });
    const l = await level();
    expect(l.on_hand).toBe(15);
    expect(l.on_hold).toBe(10);
  });

  it('cannot hold more than is un-held on the shelf', async () => {
    await expectDbError(
      `select * from post_stock_movement(p_tenant := $1, p_product := $2, p_location := $3,
        p_type := 'hold', p_quantity := 6, p_source := 'manual', p_source_ref := 'k:h2',
        p_occurred_at := now(), p_reason_code := 'qc_hold')`,
      [T, productId, locationId],
      'insufficient_stock_to_hold',
    );
  });

  it('release drains on_hold and rejects over-release', async () => {
    await post({ type: 'release', qty: 4, reason: 'release', ref: 'k:rel1' });
    expect((await level()).on_hold).toBe(6);
    await expectDbError(
      `select * from post_stock_movement(p_tenant := $1, p_product := $2, p_location := $3,
        p_type := 'release', p_quantity := 7, p_source := 'manual', p_source_ref := 'k:rel2',
        p_occurred_at := now(), p_reason_code := 'release')`,
      [T, productId, locationId],
      'insufficient_held',
    );
  });

  it('hold requires a reason code', async () => {
    await expectDbError(
      `select * from post_stock_movement(p_tenant := $1, p_product := $2, p_location := $3,
        p_type := 'hold', p_quantity := 1, p_source := 'manual', p_source_ref := 'k:h3',
        p_occurred_at := now())`,
      [T, productId, locationId],
      'missing_reason',
    );
  });

  it('hold and release are first-class ledger rows', async () => {
    const { rows } = await client.query(
      `select type, count(*) from stock_movements
       where tenant_id = $1 and type in ('hold', 'release') group by type order by type`,
      [T],
    );
    expect(rows).toEqual([
      { type: 'hold', count: '1' },
      { type: 'release', count: '1' },
    ]);
  });
});

describe('post_stock_hold — operator RPC', () => {
  it('is idempotent on the key', async () => {
    const call = () =>
      client.query(
        `select * from post_stock_hold($1, $2, $3, 'hold', 2, 'damage_hold', null, $4, 'hold-key-1')`,
        [T, locationId, productId, U],
      );
    const first = await call();
    expect(first.rows[0].out_applied).toBe(true);
    const replay = await call();
    expect(replay.rows[0].out_applied).toBe(false);
    expect((await level()).on_hold).toBe(8); // 6 + 2, once
  });
});

describe('record_stock_movements — the balance-neutral ingestion door', () => {
  it('appends history without moving balances, idempotently', async () => {
    const before = await level();
    const rows = JSON.stringify([
      {
        product_id: productId,
        location_id: locationId,
        type: 'sale',
        quantity: -3,
        source: 'csv',
        source_ref: 'hist:sale:1',
        occurred_at: '2026-05-14T00:00:00Z',
      },
      {
        product_id: productId,
        location_id: locationId,
        type: 'receipt',
        quantity: 18,
        source: 'csv',
        source_ref: 'hist:receipt:1',
        occurred_at: '2026-05-02T00:00:00Z',
      },
    ]);
    const first = await client.query(`select record_stock_movements($1, $2::jsonb) as n`, [
      T,
      rows,
    ]);
    expect(Number(first.rows[0].n)).toBe(2);
    const replay = await client.query(`select record_stock_movements($1, $2::jsonb) as n`, [
      T,
      rows,
    ]);
    expect(Number(replay.rows[0].n)).toBe(0);
    expect(await level()).toEqual(before);
  });
});

describe('purchase UoM through approve → receive → convert', () => {
  it('approve commits in_transit in stock units and receive converts qty + cost', async () => {
    // The supplier sells CASEs of 12; the case price is 24.00 → 2.00 per each.
    await client.query(
      `update product_suppliers set purchase_uom = 'case', purchase_to_stock_factor = 12,
        unit_cost = 24.00
       where tenant_id = $1 and product_id = $2 and supplier_id = $3`,
      [T, productId, supplierId],
    );
    await client.query(
      `update purchase_order_lines set unit_cost = 24.00 where tenant_id = $1 and po_id = $2`,
      [T, poId],
    );

    const before = await level();
    // Seeded PO: 1 line, ordered_qty 25 (now purchase UoM = cases).
    const approved = await client.query(`select * from apply_po_approval($1, $2, 'sent')`, [
      T,
      poId,
    ]);
    expect(approved.rows[0].out_applied).toBe(true);
    let l = await level();
    expect(l.in_transit).toBe(before.in_transit + 25 * 12);

    // Receive 2 cases → 24 eaches land; avg moves toward 2.00/each.
    const received = await client.query(
      `select * from receive_purchase_order($1, $2, now(), '{"1": 2}'::jsonb, 'uom-key-1')`,
      [T, poId],
    );
    expect(received.rows[0].out_status).toBe('partial_received');
    expect(Number(received.rows[0].out_event_qty)).toBe(2); // purchase UoM

    l = await level();
    expect(l.on_hand).toBe(before.on_hand + 24);
    expect(l.in_transit).toBe(before.in_transit + 25 * 12 - 24);

    const { rows: move } = await client.query(
      `select quantity from stock_movements
       where tenant_id = $1 and source_ref like 'receipt:po=%key=uom-key-1'`,
      [T],
    );
    expect(Number(move[0].quantity)).toBe(24); // stock UoM in the ledger

    // supplier_performance stays in purchase UoM (the unit of the promise).
    const { rows: perf } = await client.query(
      `select actual_quantity from supplier_performance
       where tenant_id = $1 and po_id = $2 and actual_quantity is not null`,
      [T, poId],
    );
    expect(Number(perf[0].actual_quantity)).toBe(2);
  });

  it('replaying the receipt key changes nothing', async () => {
    const before = await level();
    const replay = await client.query(
      `select * from receive_purchase_order($1, $2, now(), '{"1": 2}'::jsonb, 'uom-key-1')`,
      [T, poId],
    );
    expect(replay.rows[0].out_applied).toBe(false);
    expect(await level()).toEqual(before);
  });

  it('reorder policy conversion orders in purchase UoM (fractional allowed)', async () => {
    const { rows: rec } = await client.query(
      `select id from reorder_recommendations where tenant_id = $1 and status = 'open' limit 1`,
      [T],
    );
    // Seeded recommendation: 25 eaches ÷ 12 per case ≈ 2.0833 cases.
    await client.query(
      `update tenant_member_requisition_authority
       set requester_mode = 'auto_approve_unlimited', requester_limit = null
       where tenant_id = $1 and user_id = $2`,
      [T, U],
    );
    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    const converted = await client.query(
      `select * from convert_recommendations_to_requisition($1, array[$2]::uuid[])`,
      [T, rec[0].id],
    );
    await asSuperuser(client);
    const { rows: line } = await client.query(
      `select ordered_qty, unit_cost from purchase_order_lines
       where tenant_id = $1 and po_id = $2`,
      [T, converted.rows[0].out_po_id],
    );
    expect(Number(line[0].ordered_qty)).toBeCloseTo(25 / 12, 2);
    expect(Number(line[0].unit_cost)).toBe(24.0);
  });
});

describe('onboarding seed posts through the kernel', () => {
  it('creates the product AND the ledger row that explains its on-hand', async () => {
    const { rows } = await client.query(
      `select onboarding_seed_first_product($1, 'KN-SEED-1', 'Seeded Widget', 'ea', 42) as id`,
      [T],
    );
    const seededProduct = rows[0].id;
    expect((await level(seededProduct)).on_hand).toBe(42);
    const { rows: move } = await client.query(
      `select quantity, reason_code from stock_movements
       where tenant_id = $1 and product_id = $2 and type = 'adjustment'`,
      [T, seededProduct],
    );
    expect(Number(move[0].quantity)).toBe(42);
    expect(move[0].reason_code).toBe('onboarding_seed');
  });
});

describe('ledger replay equals stored balances (Item 2 acceptance)', () => {
  it('a fresh product whose every write went through the kernel replays exactly', async () => {
    const { rows: p } = await client.query(
      `insert into products (tenant_id, sku, name) values ($1, 'KN-REPLAY-1', 'Replay Widget')
       returning id`,
      [T],
    );
    const prod = p[0].id;

    await post({ type: 'receipt', qty: 60, unitCost: 1.75, prod, ref: 'rp:1' });
    await client.query(
      `select * from post_stock_movement(p_tenant := $1, p_product := $2, p_location := $3,
        p_type := 'issue_out', p_quantity := -14, p_source := 'manual', p_source_ref := 'rp:2b',
        p_occurred_at := now(), p_demand_ref_type := 'work_order', p_demand_ref_id := 'WO-10482')`,
      [T, prod, locationId],
    );
    await post({ type: 'adjustment', qty: -3.5, reason: 'damage', prod, ref: 'rp:3' });
    await post({ type: 'hold', qty: 7, reason: 'qc_hold', prod, ref: 'rp:4' });
    await post({ type: 'release', qty: 2, reason: 'release', prod, ref: 'rp:5' });
    await post({ type: 'customer_return', qty: 1.5, prod, ref: 'rp:6' });

    const { rows: replay } = await client.query(
      `select
         coalesce(sum(quantity) filter (where type not in ('hold', 'release')), 0) as on_hand,
         coalesce(sum(quantity) filter (where type = 'hold'), 0)
           - coalesce(sum(quantity) filter (where type = 'release'), 0) as on_hold
       from stock_movements where tenant_id = $1 and product_id = $2`,
      [T, prod],
    );
    const l = await level(prod);
    expect(Number(replay[0].on_hand)).toBe(l.on_hand); // 60 − 14 − 3.5 + 1.5 = 44
    expect(Number(replay[0].on_hold)).toBe(l.on_hold); // 7 − 2 = 5
    expect(l.on_hand).toBe(44);
    expect(l.on_hold).toBe(5);
  });
});
