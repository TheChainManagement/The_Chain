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

  it('creates an immutable version chain and leaves only the newest award actionable', async () => {
    await asSuperuser(client);
    const quoteResult = await client.query<{ rfq_id: string; supplier_id: string }>(
      `select q.rfq_id, q.supplier_id
       from rfq_vendor_quotes q where q.tenant_id = $1 limit 1`,
      [T],
    );
    const quote = quoteResult.rows[0];
    if (!quote) throw new Error('seed quote missing');
    const prior = await client.query<{ id: string; award_version: number }>(
      `select id, award_version from requisitions
       where tenant_id = $1 and source_rfq_id = $2 and is_current_version`,
      [T, quote.rfq_id],
    );
    const priorId = prior.rows[0]?.id;
    const priorVersion = prior.rows[0]?.award_version;
    if (!priorId) throw new Error('first award missing');
    if (!priorVersion) throw new Error('first award version missing');

    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    const reaward = await client.query<{ out_requisition_id: string }>(
      `select * from award_rfq_quotes_to_requisition($1, $2, $3::jsonb)`,
      [T, quote.rfq_id, JSON.stringify([{ lineNo: 1, supplierId: quote.supplier_id }])],
    );
    const currentId = reaward.rows[0]?.out_requisition_id;
    if (!currentId) throw new Error('re-award missing');

    await asSuperuser(client);
    const versions = await client.query<{
      id: string;
      award_version: number;
      supersedes_requisition_id: string | null;
      is_current_version: boolean;
    }>(
      `select id, award_version, supersedes_requisition_id, is_current_version
       from requisitions where tenant_id = $1 and id in ($2, $3)
       order by award_version`,
      [T, priorId, currentId],
    );
    expect(versions.rows).toEqual([
      {
        id: priorId,
        award_version: priorVersion,
        supersedes_requisition_id: versions.rows[0]?.supersedes_requisition_id ?? null,
        is_current_version: false,
      },
      {
        id: currentId,
        award_version: priorVersion + 1,
        supersedes_requisition_id: priorId,
        is_current_version: true,
      },
    ]);

    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    await client.query('savepoint immutable_header');
    await expect(
      client.query(`update requisitions set total = total where tenant_id = $1 and id = $2`, [
        T,
        priorId,
      ]),
    ).rejects.toThrow('requisition_superseded');
    await client.query('rollback to savepoint immutable_header');

    await client.query('savepoint immutable_lines');
    await expect(
      client.query(
        `update requisition_lines set qty = qty
         where tenant_id = $1 and requisition_id = $2`,
        [T, priorId],
      ),
    ).rejects.toThrow('requisition_superseded');
    await client.query('rollback to savepoint immutable_lines');

    await client.query('savepoint immutable_convert');
    await expect(
      client.query(`select * from convert_requisition_to_po($1, $2)`, [T, priorId]),
    ).rejects.toThrow('requisition_superseded');
    await client.query('rollback to savepoint immutable_convert');
  });

  it('does not reveal or mutate another tenant through the re-award RPC', async () => {
    await asSuperuser(client);
    const quote = await client.query<{ rfq_id: string; supplier_id: string }>(
      `select rfq_id, supplier_id from rfq_vendor_quotes where tenant_id = $1 limit 1`,
      [T],
    );
    const target = quote.rows[0];
    if (!target) throw new Error('seed quote missing');
    await actAs(client, {
      sub: 'c0000000-0000-0000-0000-0000000000cb',
      tenant_id: 'cccccccc-cccc-cccc-cccc-cccccccccccb',
      role: 'owner',
    });
    await client.query('savepoint cross_tenant_reaward');
    await expect(
      client.query(
        `select * from award_rfq_quotes_to_requisition($1, $2, $3::jsonb)`,
        [T, target.rfq_id, JSON.stringify([{ lineNo: 1, supplierId: target.supplier_id }])],
      ),
    ).rejects.toThrow('rfq_not_found');
    await client.query('rollback to savepoint cross_tenant_reaward');
  });

  it('refuses a re-award after the current version has become purchase orders', async () => {
    await asSuperuser(client);
    const current = await client.query<{ id: string; source_rfq_id: string }>(
      `select id, source_rfq_id from requisitions
       where tenant_id = $1 and source_rfq_id is not null and is_current_version limit 1`,
      [T],
    );
    const target = current.rows[0];
    if (!target) throw new Error('current award missing');
    const quote = await client.query<{ supplier_id: string }>(
      `select supplier_id from rfq_vendor_quotes
       where tenant_id = $1 and rfq_id = $2 and line_no = 1 limit 1`,
      [T, target.source_rfq_id],
    );
    const supplierId = quote.rows[0]?.supplier_id;
    if (!supplierId) throw new Error('seed quote missing');

    await client.query('savepoint converted_reaward');
    await client.query(`update requisitions set status = 'converted' where id = $1`, [target.id]);
    await actAs(client, { sub: U, tenant_id: T, role: 'owner' });
    await expect(
      client.query(`select * from award_rfq_quotes_to_requisition($1, $2, $3::jsonb)`, [
        T,
        target.source_rfq_id,
        JSON.stringify([{ lineNo: 1, supplierId }]),
      ]),
    ).rejects.toThrow('converted_award_cannot_be_superseded');
    await client.query('rollback to savepoint converted_reaward');
  });
});
