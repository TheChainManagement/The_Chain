import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalPayload, PushResult, SourceAdapter } from '@/lib/source-adapter';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * Wired-for verification suite (SYSTEM_DESIGN.md §Wired-for acceptance tests,
 * FEATURES.md Foundation block). Each future wave is "dry-run" against the
 * day-one foundation: the schema, RLS, adapter contract, and audit log must
 * already support it with NO migration or refactor.
 */

const T = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const U = 'd0000000-0000-0000-0000-0000000000dd';

let client: Client;
let productId: string;
let supplierId: string;
let locationId: string;

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, U, 'd');
  const ids = await client.query<{ p: string; s: string; l: string }>(
    `select
       (select id from products where tenant_id = $1 limit 1) as p,
       (select id from suppliers where tenant_id = $1 limit 1) as s,
       (select id from locations where tenant_id = $1 limit 1) as l`,
    [T],
  );
  productId = ids.rows[0]?.p ?? '';
  supplierId = ids.rows[0]?.s ?? '';
  locationId = ids.rows[0]?.l ?? '';
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('Wave 2 dry run — multi-location activation', () => {
  it('a second location flows through inventory, movements, and POs with no schema change', async () => {
    const loc2 = await client.query<{ id: string }>(
      `insert into locations (tenant_id, name, type) values ($1, 'Overflow Yard', 'warehouse') returning id`,
      [T],
    );
    const l2 = loc2.rows[0]?.id ?? '';
    expect(l2).not.toBe('');

    await client.query(
      `insert into inventory_levels (tenant_id, product_id, location_id, on_hand) values ($1, $2, $3, 12)`,
      [T, productId, l2],
    );
    await client.query(
      `insert into stock_movements (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
       values ($1, $2, $3, 'transfer_in', 12, 'manual', now())`,
      [T, productId, l2],
    );
    const po = await client.query<{ id: string }>(
      `insert into purchase_orders (tenant_id, supplier_id, location_id, status) values ($1, $2, $3, 'draft') returning id`,
      [T, supplierId, l2],
    );
    expect(po.rows[0]?.id).toBeTruthy();
  });
});

describe('Wave 3 dry run — role-based dashboards', () => {
  it('finance reads subscriptions; planner cannot — via the JWT role claim', async () => {
    await actAs(client, { sub: U, tenant_id: T, role: 'finance' });
    const fin = await client.query<{ n: number }>(
      `select count(*)::int as n from subscriptions where tenant_id = $1`,
      [T],
    );
    expect(fin.rows[0]?.n).toBeGreaterThan(0);

    await actAs(client, { sub: U, tenant_id: T, role: 'planner' });
    const plan = await client.query<{ n: number }>(
      `select count(*)::int as n from subscriptions where tenant_id = $1`,
      [T],
    );
    expect(plan.rows[0]?.n).toBe(0);
    await asSuperuser(client);
  });
});

describe('Wave 4 dry run — cycle counts close into stock movements', () => {
  it('a cycle-count close inserts a cycle_count movement and adjusts on_hand', async () => {
    await client.query(
      `insert into stock_movements (tenant_id, product_id, location_id, type, quantity, source, occurred_at)
       values ($1, $2, $3, 'cycle_count', -2, 'manual', now())`,
      [T, productId, locationId],
    );
    const upd = await client.query(
      `update inventory_levels set on_hand = on_hand - 2, last_counted_at = now()
       where tenant_id = $1 and product_id = $2 and location_id = $3`,
      [T, productId, locationId],
    );
    expect(upd.rowCount).toBe(1);
  });
});

describe('Wave 5 + 7 dry runs — alternate adapters conform to the contract', () => {
  function mockAdapter(source: SourceAdapter['source'], webhooks: boolean): SourceAdapter {
    return {
      source,
      capabilities: {
        readProducts: true,
        readSuppliers: true,
        readProductSuppliers: true,
        readInventory: true,
        readPurchaseOrders: true,
        readStockMovements: true,
        writePurchaseOrders: source !== 'cin7',
        webhooks,
      },
      async pull(kind, _cursor, _key) {
        const item = {
          kind,
          externalId: `${source}-1`,
          schemaVersion: 1,
          attributes: { sku: 'X', name: 'Y' },
        } as unknown as CanonicalPayload<typeof kind>;
        return { items: [item], nextCursor: null, errors: [] };
      },
      async push(_kind, _payload, _key): Promise<PushResult> {
        return {
          externalId: `${source}-po-1`,
          externalVersion: 1,
          appliedAt: '2026-01-01T00:00:00Z',
        };
      },
    };
  }

  it('a Rutter adapter satisfies SourceAdapter and gates write-back via capabilities', async () => {
    const rutter = mockAdapter('rutter', true);
    expect(rutter.source).toBe('rutter');
    expect(rutter.capabilities.writePurchaseOrders).toBe(true);
    const res = await rutter.pull('product', null, 'k1');
    expect(res.items[0]?.kind).toBe('product');
    expect(res.errors).toEqual([]);
  });

  it('a Cin7 adapter uses the same contract with different capability flags', async () => {
    const cin7 = mockAdapter('cin7', false);
    expect(cin7.capabilities.webhooks).toBe(false);
    // Read-only ERP: write-back hidden by the capability flag, no schema change.
    expect(cin7.capabilities.writePurchaseOrders).toBe(false);
    const res = await cin7.pull('inventory_level', null, 'k1');
    expect(res.items).toHaveLength(1);
  });
});

describe('Wave 6 dry run — ROI deltas are reconstructable from the audit log', () => {
  it('inventory + PO + movement audit rows carry the deltas ROI needs', async () => {
    // Mutate to produce before/after deltas.
    await client.query(
      `update inventory_levels set on_hand = on_hand + 25 where tenant_id = $1 and product_id = $2 and location_id = $3`,
      [T, productId, locationId],
    );
    await client.query(
      `update purchase_orders set status = 'approved', actual_delivery_at = now() where tenant_id = $1`,
      [T],
    );

    const inv = await client.query<{
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      `select before, after from audit_log where tenant_id = $1 and entity_type = 'inventory_levels' and action = 'inventory_levels.update' order by id desc limit 1`,
      [T],
    );
    expect(inv.rows[0]?.before).toHaveProperty('on_hand');
    expect(inv.rows[0]?.after).toHaveProperty('on_hand');

    const po = await client.query<{
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      `select before, after from audit_log where tenant_id = $1 and entity_type = 'purchase_orders' and action = 'purchase_orders.update' order by id desc limit 1`,
      [T],
    );
    expect(po.rows[0]?.before).toHaveProperty('status');
    expect(po.rows[0]?.after).toHaveProperty('total');
    expect(po.rows[0]?.after).toHaveProperty('actual_delivery_at');

    const mv = await client.query<{ after: Record<string, unknown> }>(
      `select after from audit_log where tenant_id = $1 and entity_type = 'stock_movements' and action = 'stock_movements.insert' order by id desc limit 1`,
      [T],
    );
    expect(mv.rows[0]?.after).toHaveProperty('quantity');
  });
});

describe('Pricing + retention swaps need no code change', () => {
  it('subscription status moves through trial -> active -> comp', async () => {
    for (const status of ['active', 'comp', 'trial'] as const) {
      const res = await client.query(`update subscriptions set status = $2 where tenant_id = $1`, [
        T,
        status,
      ]);
      expect(res.rowCount).toBe(1);
    }
  });

  it('retention tier widens starter -> pro -> enterprise', async () => {
    for (const tier of ['starter', 'pro', 'enterprise'] as const) {
      const res = await client.query(
        `update subscriptions set retention_tier = $2 where tenant_id = $1`,
        [T, tier],
      );
      expect(res.rowCount).toBe(1);
    }
  });
});
