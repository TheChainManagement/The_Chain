import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'cccccccc-cccc-cccc-cccc-ccccccccccca';
const U = 'c0000000-0000-0000-0000-0000000000ca';

let client: Client;

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'award');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('award_rfq_quotes_to_requisition', () => {
  it('atomically derives purchase quantity and total from the locked quote snapshot', async () => {
    await asSuperuser(client);
    const { rows } = await client.query<{ rfq_id: string; supplier_id: string }>(
      `select q.rfq_id, q.supplier_id
       from rfq_vendor_quotes q where q.tenant_id = $1 limit 1`,
      [T],
    );
    const quote = rows[0];
    if (!quote) throw new Error('seed quote missing');
    await client.query(`update rfqs set status = 'sent' where tenant_id = $1 and id = $2`, [
      T,
      quote.rfq_id,
    ]);
    await client.query(
      `update rfq_vendor_quotes set moq = 5
       where tenant_id = $1 and rfq_id = $2 and supplier_id = $3 and line_no = 1`,
      [T, quote.rfq_id, quote.supplier_id],
    );

    const before = await client.query<{ levels: string; movements: string }>(
      `select
         (select jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id)::text
          from inventory_levels il where il.tenant_id = $1) as levels,
         (select count(*)::text from stock_movements where tenant_id = $1) as movements`,
      [T],
    );

    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    const awarded = await client.query<{
      out_requisition_id: string;
      out_total: string;
    }>(`select * from award_rfq_quotes_to_requisition($1, $2, $3::jsonb)`, [
      T,
      quote.rfq_id,
      JSON.stringify([{ lineNo: 1, supplierId: quote.supplier_id }]),
    ]);
    expect(Number(awarded.rows[0]?.out_total)).toBe(120);

    await asSuperuser(client);
    const line = await client.query<{
      qty: string;
      purchase_to_stock_factor: string;
      source_quote_rfq_id: string;
    }>(
      `select qty, purchase_to_stock_factor, source_quote_rfq_id
       from requisition_lines where requisition_id = $1`,
      [awarded.rows[0]?.out_requisition_id],
    );
    expect(Number(line.rows[0]?.qty)).toBe(5);
    expect(Number(line.rows[0]?.purchase_to_stock_factor)).toBe(12);
    expect(line.rows[0]?.source_quote_rfq_id).toBe(quote.rfq_id);

    const after = await client.query<{ levels: string; movements: string }>(
      `select
         (select jsonb_agg(to_jsonb(il) order by il.product_id, il.location_id)::text
          from inventory_levels il where il.tenant_id = $1) as levels,
         (select count(*)::text from stock_movements where tenant_id = $1) as movements`,
      [T],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
