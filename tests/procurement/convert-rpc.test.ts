import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * W2-3d convert_requisition_to_po — real-DB contract probes.
 *
 * An approved mixed-vendor requisition fans out to one draft PO per supplier
 * with purchase-UoM lines copied straight across and requisition_id
 * back-referenced; the requisition stamps converted; replay is idempotent
 * (existing POs, out_applied=false); unapproved documents refuse; and the
 * whole conversion performs ZERO balance writes (the satellite-module
 * contract, design §1). Runs in one rolled-back transaction.
 */

const T = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const U = 'e0000000-0000-0000-0000-0000000000ee';

let client: Client;
let reqId = '';

async function one<T2 extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const { rows } = await client.query<T2>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`expected a row from: ${sql}`);
  return row;
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'e');

  // A second supplier so the requisition is mixed-vendor.
  const ids = await one<{ loc: string; prod: string; sup1: string }>(
    `select
       (select id from locations where tenant_id = $1 limit 1) as loc,
       (select id from products  where tenant_id = $1 limit 1) as prod,
       (select id from suppliers where tenant_id = $1 limit 1) as sup1`,
    [T],
  );
  const sup2 = await one<{ id: string }>(
    `insert into suppliers (tenant_id, name) values ($1, 'Second Source e') returning id`,
    [T],
  );
  const req = await one<{ id: string }>(
    `insert into requisitions (tenant_id, location_id, requested_by_user_id, total, status)
     values ($1, $2, $3, 146.00, 'submitted') returning id`,
    [T, ids.loc, U],
  );
  reqId = req.id;
  await client.query(
    `insert into requisition_lines
       (tenant_id, requisition_id, line_no, product_id, supplier_id, qty, unit_cost, purchase_uom, purchase_to_stock_factor)
     values
       ($1, $2, 1, $3, $4, 4, 24.00, 'CS', 12),
       ($1, $2, 2, $3, $5, 10, 5.00, null, null)`,
    [T, reqId, ids.prod, ids.sup1, sup2.id],
  );
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('convert_requisition_to_po', () => {
  it('refuses a document that is not approved', async () => {
    await as('owner');
    await client.query('savepoint not_approved');
    await expect(
      client.query('select * from convert_requisition_to_po($1, $2)', [T, reqId]),
    ).rejects.toThrow(/not_approved/);
    await client.query('rollback to savepoint not_approved');
  });

  it('fans an approved mixed-vendor requisition out to one draft PO per supplier, zero balance writes', async () => {
    await asSuperuser(client);
    await client.query(`update requisitions set status = 'approved' where id = $1`, [reqId]);
    const before = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    await as('owner');
    const { rows } = await client.query<{
      out_po_id: string;
      out_supplier_id: string;
      out_line_count: number;
      out_applied: boolean;
    }>('select * from convert_requisition_to_po($1, $2)', [T, reqId]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.out_applied)).toBe(true);

    await asSuperuser(client);
    const req = await one<{ status: string }>(`select status from requisitions where id = $1`, [
      reqId,
    ]);
    expect(req.status).toBe('converted');

    const pos = await client.query<{
      id: string;
      status: string;
      total: string;
      requisition_id: string;
    }>(`select id, status, total, requisition_id from purchase_orders where requisition_id = $1`, [
      reqId,
    ]);
    expect(pos.rows).toHaveLength(2);
    expect(pos.rows.every((p) => p.status === 'draft' && p.requisition_id === reqId)).toBe(true);
    const totals = pos.rows.map((p) => Number(p.total)).sort((a, b) => a - b);
    expect(totals).toEqual([50, 96]); // 10 × $5 and 4 CS × $24

    const lines = await client.query(
      `select pol.ordered_qty, pol.unit_cost from purchase_order_lines pol
       join purchase_orders po on po.id = pol.po_id
       where po.requisition_id = $1 order by pol.ordered_qty`,
      [reqId],
    );
    expect(lines.rows).toHaveLength(2);

    const after = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );
    expect(after.levels).toBe(before.levels);
    expect(after.movements).toBe(before.movements);
  });

  it('replays idempotently: the existing POs come back, nothing new is created', async () => {
    await as('owner');
    const { rows } = await client.query<{ out_po_id: string; out_applied: boolean }>(
      'select * from convert_requisition_to_po($1, $2)',
      [T, reqId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.out_applied === false)).toBe(true);

    await asSuperuser(client);
    const count = await one<{ n: number }>(
      `select count(*)::int as n from purchase_orders where requisition_id = $1`,
      [reqId],
    );
    expect(Number(count.n)).toBe(2);
  });
});

function as(role: string) {
  return actAs(client, { sub: U, tenant_id: T, role });
}
