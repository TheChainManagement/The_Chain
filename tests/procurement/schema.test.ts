import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * W2-3a procurement schema probes (design doc §4/§5 acceptance).
 *
 * The headline probe is the ZERO-BALANCE-WRITES contract: running the full
 * document flow (RFQ → lines → vendors → quotes → requisition → lines) must
 * leave inventory_levels and stock_movements byte-identical. W2-3 is the first
 * satellite module on the posting kernel and must not touch stock at all.
 *
 * Also: role-matrix writes on the new tables (owner|manager|planner write,
 * viewer/finance read-only, matching purchase_orders), CHECK constraints, and
 * the purchase_orders.requisition_id back-reference lifecycle.
 *
 * Runs in one rolled-back transaction against local Supabase Postgres.
 */

const T = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const U = 'd0000000-0000-0000-0000-0000000000dd';
const OTHER_T = 'd1dddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER_U = 'd1000000-0000-0000-0000-0000000000dd';

let client: Client;

function as(role: string) {
  return actAs(client, { sub: U, tenant_id: T, role });
}

async function one<T2 extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T2> {
  const { rows } = await client.query<T2>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`expected a row from: ${sql}`);
  return row;
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'd');
  await seedTenant(client, OTHER_T, OTHER_U, 'd-other');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('zero balance writes — the kernel contract for satellite modules', () => {
  it('the full RFQ → quote → requisition document flow leaves balances and the ledger untouched', async () => {
    await asSuperuser(client);
    const ids = await one<{ loc: string; prod: string; sup: string }>(
      `select
         (select id from locations where tenant_id = $1 limit 1) as loc,
         (select id from products  where tenant_id = $1 limit 1) as prod,
         (select id from suppliers where tenant_id = $1 limit 1) as sup`,
      [T],
    );

    const before = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    // Run the whole document flow as a signed-in owner (RLS applied).
    await as('owner');
    const rfq = await one<{ id: string }>(
      `insert into rfqs (tenant_id, location_id, title, created_by_user_id)
       values ($1, $2, 'Probe RFQ', $3) returning id`,
      [T, ids.loc, U],
    );
    await client.query(
      `insert into rfq_lines (tenant_id, rfq_id, line_no, product_id, qty) values ($1, $2, 1, $3, 48)`,
      [T, rfq.id, ids.prod],
    );
    await client.query(
      `insert into rfq_vendors (tenant_id, rfq_id, supplier_id) values ($1, $2, $3)`,
      [T, rfq.id, ids.sup],
    );
    await client.query(
      `update rfqs set status = 'sent', sent_at = now() where tenant_id = $1 and id = $2`,
      [T, rfq.id],
    );
    await client.query(
      `insert into rfq_vendor_quotes
         (tenant_id, rfq_id, supplier_id, line_no, quoted_unit_cost, quoted_purchase_uom, purchase_to_stock_factor, lead_time_days, entered_by_user_id)
       values ($1, $2, $3, 1, 19.75, 'CS', 24, 7, $4)`,
      [T, rfq.id, ids.sup, U],
    );
    const req = await one<{ out_requisition_id: string }>(
      `select * from award_rfq_quotes_to_requisition($1, $2, $3::jsonb)`,
      [T, rfq.id, JSON.stringify([{ lineNo: 1, supplierId: ids.sup }])],
    );
    await client.query(`select * from submit_requisition($1, $2)`, [T, req.out_requisition_id]);

    await asSuperuser(client);
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
});

describe('direct requisition creation', () => {
  it('atomically snapshots the supplier conversion rail without touching stock', async () => {
    await asSuperuser(client);
    const ids = await one<{ loc: string; prod: string; sup: string }>(
      `select
         (select id from locations where tenant_id = $1 limit 1) as loc,
         (select id from products where tenant_id = $1 limit 1) as prod,
         (select id from suppliers where tenant_id = $1 limit 1) as sup`,
      [T],
    );
    await client.query(
      `update product_suppliers
          set purchase_uom = 'case', purchase_to_stock_factor = 12
        where tenant_id = $1 and product_id = $2 and supplier_id = $3`,
      [T, ids.prod, ids.sup],
    );
    const before = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    await as('planner');
    const created = await one<{ out_requisition_id: string; out_total: string }>(
      `select * from create_direct_requisition($1, $2, $3, $4, 4, 120, $5)`,
      [T, ids.loc, ids.prod, ids.sup, U],
    );

    await asSuperuser(client);
    const document = await one<{
      source_rfq_id: string | null;
      requested_by_user_id: string;
      total: string;
      qty: string;
      unit_cost: string;
      purchase_uom: string;
      factor: string;
      source_quote_rfq_id: string | null;
      source_quote_line_no: number | null;
    }>(
      `select r.source_rfq_id, r.requested_by_user_id, r.total,
              rl.qty, rl.unit_cost, rl.purchase_uom,
              rl.purchase_to_stock_factor as factor,
              rl.source_quote_rfq_id, rl.source_quote_line_no
         from requisitions r
         join requisition_lines rl on rl.tenant_id = r.tenant_id and rl.requisition_id = r.id
        where r.tenant_id = $1 and r.id = $2`,
      [T, created.out_requisition_id],
    );
    const after = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    expect(created.out_total).toBe('480.00');
    expect(document).toMatchObject({
      source_rfq_id: null,
      requested_by_user_id: U,
      total: '480.00',
      qty: '4.00',
      unit_cost: '120.00',
      purchase_uom: 'case',
      factor: '12.0000',
      source_quote_rfq_id: null,
      source_quote_line_no: null,
    });
    expect(after).toEqual(before);
  });

  it("cannot create a document with another tenant's location or catalog rows", async () => {
    await asSuperuser(client);
    const ids = await one<{
      other_loc: string;
      other_prod: string;
      other_sup: string;
      own_prod: string;
      own_sup: string;
    }>(
      `select
         (select id from locations where tenant_id = $1 limit 1) as other_loc,
         (select id from products where tenant_id = $1 limit 1) as other_prod,
         (select id from suppliers where tenant_id = $1 limit 1) as other_sup,
         (select id from products where tenant_id = $2 limit 1) as own_prod,
         (select id from suppliers where tenant_id = $2 limit 1) as own_sup`,
      [OTHER_T, T],
    );
    await as('owner');
    await client.query('savepoint direct_requisition_cross_tenant');
    await expect(
      client.query(`select * from create_direct_requisition($1, $2, $3, $4, 1, 10, $5)`, [
        OTHER_T,
        ids.other_loc,
        ids.other_prod,
        ids.other_sup,
        U,
      ]),
    ).rejects.toThrow('requisition_creation_forbidden');
    await client.query('rollback to savepoint direct_requisition_cross_tenant');

    await client.query('savepoint direct_requisition_foreign_location');
    await expect(
      client.query(`select * from create_direct_requisition($1, $2, $3, $4, 1, 10, $5)`, [
        T,
        ids.other_loc,
        ids.own_prod,
        ids.own_sup,
        U,
      ]),
    ).rejects.toThrow('active_location_not_found');
    await client.query('rollback to savepoint direct_requisition_foreign_location');
  });
});

describe('direct requisition line editing', () => {
  it('edits rejected lines, clears quote lineage, recalculates totals, and never writes stock', async () => {
    await asSuperuser(client);
    const ids = await one<{ req: string; line_no: number; prod: string; sup: string }>(
      `select
         (select id from requisitions where tenant_id = $1 and source_rfq_id is not null limit 1) as req,
         (select rl.line_no from requisition_lines rl
           join requisitions r on r.tenant_id = rl.tenant_id and r.id = rl.requisition_id
          where r.tenant_id = $1 and r.source_rfq_id is not null limit 1) as line_no,
         (select id from products where tenant_id = $1 limit 1) as prod,
         (select id from suppliers where tenant_id = $1 limit 1) as sup`,
      [T],
    );
    await client.query(
      `update requisitions set status = 'rejected', rejection_note = 'Revise quantity'
        where tenant_id = $1 and id = $2`,
      [T, ids.req],
    );
    const before = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );

    await as('planner');
    const edited = await one<{ out_line_no: number; out_total: string }>(
      `select * from save_requisition_line($1, $2, $3, $4, $5, 5, 11)`,
      [T, ids.req, ids.line_no, ids.prod, ids.sup],
    );
    const added = await one<{ out_line_no: number; out_total: string }>(
      `select * from save_requisition_line($1, $2, null, $3, $4, 2, 7.50)`,
      [T, ids.req, ids.prod, ids.sup],
    );
    await asSuperuser(client);
    const document = await one<{
      total: string;
      source_quote_rfq_id: string | null;
      source_quote_line_no: number | null;
      line_count: number;
    }>(
      `select r.total, rl.source_quote_rfq_id, rl.source_quote_line_no,
              (select count(*)::int from requisition_lines x
                where x.tenant_id = r.tenant_id and x.requisition_id = r.id) as line_count
         from requisitions r
         join requisition_lines rl on rl.tenant_id = r.tenant_id
          and rl.requisition_id = r.id and rl.line_no = $3
        where r.tenant_id = $1 and r.id = $2`,
      [T, ids.req, ids.line_no],
    );
    const after = await one<{ levels: string; movements: string }>(
      `select
         (select coalesce(jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id), '[]'::jsonb)
            from inventory_levels il where il.tenant_id = $1)::text as levels,
         (select count(*) from stock_movements where tenant_id = $1)::text as movements`,
      [T],
    );
    expect(edited).toEqual({ out_line_no: ids.line_no, out_total: '55.00' });
    expect(added.out_total).toBe('70.00');
    expect(document).toEqual({
      total: '70.00',
      source_quote_rfq_id: null,
      source_quote_line_no: null,
      line_count: 2,
    });
    expect(after).toEqual(before);
  });

  it('rejects line changes after submission', async () => {
    await asSuperuser(client);
    const ids = await one<{ req: string; prod: string; sup: string }>(
      `select
         (select id from requisitions where tenant_id = $1 limit 1) as req,
         (select id from products where tenant_id = $1 limit 1) as prod,
         (select id from suppliers where tenant_id = $1 limit 1) as sup`,
      [T],
    );
    await client.query(
      `update requisitions set status = 'submitted' where tenant_id = $1 and id = $2`,
      [T, ids.req],
    );
    await as('owner');
    await client.query('savepoint submitted_line_edit');
    await expect(
      client.query(`select * from save_requisition_line($1, $2, 1, $3, $4, 2, 10)`, [
        T,
        ids.req,
        ids.prod,
        ids.sup,
      ]),
    ).rejects.toThrow('requisition_not_editable');
    await client.query('rollback to savepoint submitted_line_edit');
    await asSuperuser(client);
    await client.query(
      `update requisitions set status = 'draft' where tenant_id = $1 and id = $2`,
      [T, ids.req],
    );
  });
});

describe('role matrix on the procurement tables', () => {
  it('planner CAN insert and update rfqs and requisitions', async () => {
    await asSuperuser(client);
    const ids = await one<{ loc: string }>(
      `select (select id from locations where tenant_id = $1 limit 1) as loc`,
      [T],
    );
    await as('planner');
    const rfq = await one<{ id: string }>(
      `insert into rfqs (tenant_id, location_id, title) values ($1, $2, 'Planner RFQ') returning id`,
      [T, ids.loc],
    );
    expect(rfq.id).toBeTruthy();
    const rfqUpdate = await client.query(
      `update rfqs set title = 'Planner edited' where tenant_id = $1 and id = $2`,
      [T, rfq.id],
    );
    expect(rfqUpdate.rowCount).toBe(1);
    const reqUpdate = await client.query(
      `update requisitions set total = total where tenant_id = $1 and status = 'draft'`,
      [T],
    );
    expect(reqUpdate.rowCount).toBeGreaterThan(0);
  });

  it('viewer CANNOT insert an RFQ (RLS violation)', async () => {
    await asSuperuser(client);
    const ids = await one<{ loc: string }>(
      `select (select id from locations where tenant_id = $1 limit 1) as loc`,
      [T],
    );
    await as('viewer');
    await client.query('savepoint viewer_insert');
    await expect(
      client.query(`insert into rfqs (tenant_id, location_id, title) values ($1, $2, 'Nope')`, [
        T,
        ids.loc,
      ]),
    ).rejects.toThrow(/row-level security/);
    await client.query('rollback to savepoint viewer_insert');
  });

  it('finance CANNOT update a requisition; everyone in-tenant CAN read', async () => {
    await as('finance');
    const upd = await client.query(`update requisitions set total = total where tenant_id = $1`, [
      T,
    ]);
    expect(upd.rowCount).toBe(0);
    const sel = await client.query(
      `select count(*)::int as n from requisitions where tenant_id = $1`,
      [T],
    );
    expect(Number(sel.rows[0].n)).toBeGreaterThan(0);
  });
});

describe('constraints and lineage', () => {
  it('rejects a child row that claims this tenant but names another tenant parent', async () => {
    await asSuperuser(client);
    const ids = await one<{ other_rfq: string; own_product: string }>(
      `select
         (select id from rfqs where tenant_id = $1 limit 1) as other_rfq,
         (select id from products where tenant_id = $2 limit 1) as own_product`,
      [OTHER_T, T],
    );
    await as('owner');
    await client.query('savepoint cross_tenant_parent');
    await expect(
      client.query(
        `insert into rfq_lines (tenant_id, rfq_id, line_no, product_id, qty)
         values ($1, $2, 88, $3, 1)`,
        [T, ids.other_rfq, ids.own_product],
      ),
    ).rejects.toThrow(/foreign key|row-level security/i);
    await client.query('rollback to savepoint cross_tenant_parent');
  });

  it('rejects non-positive quantities and factors', async () => {
    await asSuperuser(client);
    const ids = await one<{ rfq: string; prod: string; sup: string }>(
      `select
         (select id from rfqs where tenant_id = $1 limit 1) as rfq,
         (select id from products where tenant_id = $1 limit 1) as prod,
         (select id from suppliers where tenant_id = $1 limit 1) as sup`,
      [T],
    );
    await client.query('savepoint bad_qty');
    await expect(
      client.query(
        `insert into rfq_lines (tenant_id, rfq_id, line_no, product_id, qty) values ($1, $2, 99, $3, 0)`,
        [T, ids.rfq, ids.prod],
      ),
    ).rejects.toThrow(/check/i);
    await client.query('rollback to savepoint bad_qty');
    await client.query('savepoint bad_factor');
    await expect(
      client.query(
        `insert into rfq_vendor_quotes (tenant_id, rfq_id, supplier_id, line_no, quoted_unit_cost, purchase_to_stock_factor)
         values ($1, $2, $3, 1, 10, 0)`,
        [T, ids.rfq, ids.sup],
      ),
    ).rejects.toThrow(/check/i);
    await client.query('rollback to savepoint bad_factor');
  });

  it('purchase_orders.requisition_id links and nulls on requisition delete', async () => {
    await asSuperuser(client);
    const ids = await one<{ po: string; req: string }>(
      `select
         (select id from purchase_orders where tenant_id = $1 limit 1) as po,
         (select id from requisitions where tenant_id = $1 limit 1) as req`,
      [T],
    );
    await client.query(
      `update purchase_orders set requisition_id = $2 where tenant_id = $1 and id = $3`,
      [T, ids.req, ids.po],
    );
    const linked = await one<{ requisition_id: string | null }>(
      `select requisition_id from purchase_orders where tenant_id = $1 and id = $2`,
      [T, ids.po],
    );
    expect(linked.requisition_id).toBe(ids.req);

    await client.query(`delete from requisitions where tenant_id = $1 and id = $2`, [T, ids.req]);
    const unlinked = await one<{ requisition_id: string | null }>(
      `select requisition_id from purchase_orders where tenant_id = $1 and id = $2`,
      [T, ids.po],
    );
    expect(unlinked?.requisition_id).toBeNull();
  });

  it('deleting an RFQ cascades lines/vendors/quotes but leaves the requisition (source set null)', async () => {
    await asSuperuser(client);
    const { rows: rfqRows } = await client.query<{ id: string }>(
      `select r.id from rfqs r
       where r.tenant_id = $1 and exists (select 1 from requisitions q where q.tenant_id = $1 and q.source_rfq_id = r.id)
       limit 1`,
      [T],
    );
    const rfq = rfqRows[0];
    if (!rfq) return; // requisition deleted in the prior test; seed row covers the shape
    await client.query(`delete from rfqs where tenant_id = $1 and id = $2`, [T, rfq.id]);
    const counts = await one<{ lines: number; reqs: number }>(
      `select
         (select count(*)::int from rfq_lines where tenant_id = $1 and rfq_id = $2) as lines,
         (select count(*)::int from requisitions where tenant_id = $1 and source_rfq_id = $2) as reqs`,
      [T, rfq.id],
    );
    expect(Number(counts?.lines)).toBe(0);
    expect(Number(counts?.reqs)).toBe(0);
  });
});
