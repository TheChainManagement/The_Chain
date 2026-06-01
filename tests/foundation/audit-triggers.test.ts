import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from '../helpers/db';

/**
 * Phase 5F acceptance — the audit dispatcher fires on every tracked table and
 * records the columns Wave 6 ROI needs, with secrets redacted.
 *
 * FEATURES.md §Wave 1 Foundation:
 *   "Audit log trigger fires on every tracked mutation. Verified by a test that
 *    mutates each tracked table and asserts a corresponding audit_log row exists
 *    with the required fields populated."
 *
 * Everything runs inside ONE transaction that is rolled back in afterAll, so the
 * database is left untouched. audit_log rows written by the triggers are visible
 * within the same transaction, which is exactly what we assert against.
 */

// Fixed fixture UUIDs so cross-references are readable.
const T = '11111111-1111-1111-1111-111111111111'; // tenant
const U = '22222222-2222-2222-2222-222222222222'; // auth user
const L = '33333333-3333-3333-3333-333333333333'; // location (not tracked)
const S = '44444444-4444-4444-4444-444444444444'; // supplier
const P = '55555555-5555-5555-5555-555555555555'; // product
const SC = '66666666-6666-6666-6666-666666666666'; // source_connection
const PO = '77777777-7777-7777-7777-777777777777'; // purchase_order

// The 13 tracked tables from FEATURES.md step 6.
const TRACKED = [
  'products',
  'purchase_orders',
  'purchase_order_lines',
  'inventory_levels',
  'stock_movements',
  'suppliers',
  'product_suppliers',
  'subscriptions',
  'tenant_members',
  'source_connections',
  'reorder_recommendations',
  'inventory_policy',
  'sync_conflicts',
] as const;

let client: Client;

async function latestAudit(entityType: string, action: string) {
  const { rows } = await client.query(
    'select * from audit_log where entity_type = $1 and action = $2 order by id desc limit 1',
    [entityType, action],
  );
  return rows[0] as
    | {
        tenant_id: string;
        entity_id: string | null;
        action: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }
    | undefined;
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');

  // --- Seed FK parents (tenants, auth.users, locations are NOT tracked) ---
  await client.query(
    `insert into tenants (id, name, slug) values ('${T}', 'Audit Test Co', 'audit-test-co')`,
  );
  await client.query(
    `insert into auth.users (id, instance_id, email) values ('${U}', '00000000-0000-0000-0000-000000000000', 'audit-pilot@example.test')`,
  );
  await client.query(
    `insert into locations (tenant_id, id, name, type) values ('${T}', '${L}', 'Main DC', 'warehouse')`,
  );

  // --- Insert into every tracked table (fires <table>.insert audit rows) ---
  await client.query(`insert into subscriptions (tenant_id, status) values ('${T}', 'trial')`);
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ('${T}', '${U}', 'owner')`,
  );
  await client.query(
    `insert into suppliers (tenant_id, id, name) values ('${T}', '${S}', 'Acme Supply')`,
  );
  await client.query(
    `insert into products (tenant_id, id, sku, name, primary_supplier_id) values ('${T}', '${P}', 'SKU-1', 'Widget', '${S}')`,
  );
  await client.query(
    `insert into product_suppliers (tenant_id, product_id, supplier_id, unit_cost, is_primary) values ('${T}', '${P}', '${S}', 9.50, true)`,
  );
  await client.query(
    `insert into inventory_levels (tenant_id, product_id, location_id, on_hand, allocated, in_transit) values ('${T}', '${P}', '${L}', 100, 10, 5)`,
  );
  await client.query(
    `insert into stock_movements (tenant_id, product_id, location_id, type, quantity, source, occurred_at) values ('${T}', '${P}', '${L}', 'receipt', 50, 'manual', now())`,
  );
  await client.query(
    `insert into reorder_recommendations (tenant_id, product_id, location_id, supplier_id, recommended_qty) values ('${T}', '${P}', '${L}', '${S}', 25)`,
  );
  await client.query(
    `insert into inventory_policy (tenant_id, product_id, location_id, lead_time_days_used) values ('${T}', '${P}', '${L}', 7)`,
  );
  await client.query(
    `insert into purchase_orders (tenant_id, id, supplier_id, location_id, status, total, expected_delivery_at) values ('${T}', '${PO}', '${S}', '${L}', 'draft', 1000.00, now() + interval '7 days')`,
  );
  await client.query(
    `insert into purchase_order_lines (tenant_id, po_id, line_no, product_id, ordered_qty) values ('${T}', '${PO}', 1, '${P}', 25)`,
  );
  await client.query(
    `insert into source_connections (tenant_id, id, source, encrypted_credentials) values ('${T}', '${SC}', 'qbo', '\\xdeadbeef'::bytea)`,
  );
  await client.query(
    `insert into sync_conflicts (tenant_id, source_connection_id, entity_type, policy_decision) values ('${T}', '${SC}', 'product', 'needs_review')`,
  );

  // --- UPDATE (before+after) and DELETE (before, null after) coverage ---
  await client.query(
    `update purchase_orders set status = 'approved', actual_delivery_at = now() where id = '${PO}'`,
  );
  await client.query(
    `delete from product_suppliers where tenant_id = '${T}' and product_id = '${P}' and supplier_id = '${S}'`,
  );
}, 30_000);

afterAll(async () => {
  if (client) {
    await client.query('rollback');
    await client.end();
  }
});

describe('audit dispatcher — fires on every tracked table', () => {
  for (const table of TRACKED) {
    it(`writes an audit row for ${table}.insert`, async () => {
      const row = await latestAudit(table, `${table}.insert`);
      expect(row, `expected an audit_log row for ${table}.insert`).toBeDefined();
      expect(row?.tenant_id).toBe(T);
      // INSERT: before is null, after is the captured row snapshot.
      expect(row?.before).toBeNull();
      expect(row?.after).toBeTruthy();
    });
  }

  it('covers the 13 core tracked tables (5J hardening widened audit to every tenant table)', async () => {
    const { rows } = await client.query(
      "select distinct entity_type from audit_log where action like '%.insert' order by entity_type",
    );
    const captured = new Set(rows.map((r: { entity_type: string }) => r.entity_type));
    for (const table of TRACKED) {
      expect(captured.has(table), `expected ${table} to be audited`).toBe(true);
    }
    // audit_log must never audit itself (recursion guard).
    expect(captured.has('audit_log')).toBe(false);
  });

  it('audit dispatcher is attached to every tenant-scoped table except audit_log', async () => {
    const { rows } = await client.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
        and c.relname <> 'audit_log'
        and not exists (
          select 1 from pg_trigger tg
          where tg.tgrelid = c.oid and tg.tgname = 'audit_' || c.relname
        )
    `);
    const untracked = rows.map((r) => r.relname);
    expect(untracked, `tenant tables missing an audit trigger: ${untracked.join(', ')}`).toEqual([]);
  });
});

describe('Wave 6 ROI fields are captured', () => {
  it('inventory_levels: on_hand, allocated, in_transit, location_id', async () => {
    const row = await latestAudit('inventory_levels', 'inventory_levels.insert');
    const after = row?.after ?? {};
    for (const f of ['on_hand', 'allocated', 'in_transit', 'location_id']) {
      expect(after, `inventory_levels.after missing ${f}`).toHaveProperty(f);
    }
    expect(Number(after.on_hand)).toBe(100);
    expect(after.location_id).toBe(L);
  });

  it('purchase_orders: status, total, expected/actual_delivery_at, supplier_id', async () => {
    const row = await latestAudit('purchase_orders', 'purchase_orders.insert');
    const after = row?.after ?? {};
    for (const f of [
      'status',
      'total',
      'expected_delivery_at',
      'actual_delivery_at',
      'supplier_id',
    ]) {
      expect(after, `purchase_orders.after missing ${f}`).toHaveProperty(f);
    }
    expect(after.status).toBe('draft');
    expect(after.supplier_id).toBe(S);
  });

  it('stock_movements: type, quantity, product_id, location_id, occurred_at', async () => {
    const row = await latestAudit('stock_movements', 'stock_movements.insert');
    const after = row?.after ?? {};
    for (const f of ['type', 'quantity', 'product_id', 'location_id', 'occurred_at']) {
      expect(after, `stock_movements.after missing ${f}`).toHaveProperty(f);
    }
    expect(after.type).toBe('receipt');
    expect(Number(after.quantity)).toBe(50);
  });
});

describe('update + delete semantics', () => {
  it('UPDATE captures before and after with the changed column', async () => {
    const row = await latestAudit('purchase_orders', 'purchase_orders.update');
    expect(row).toBeDefined();
    expect((row?.before as { status?: string })?.status).toBe('draft');
    expect((row?.after as { status?: string })?.status).toBe('approved');
  });

  it('DELETE captures before with after null', async () => {
    const row = await latestAudit('product_suppliers', 'product_suppliers.delete');
    expect(row).toBeDefined();
    expect(row?.before).toBeTruthy();
    expect(row?.after).toBeNull();
  });
});

describe('secret redaction', () => {
  it('source_connections.encrypted_credentials never reaches the audit trail', async () => {
    const row = await latestAudit('source_connections', 'source_connections.insert');
    const after = row?.after ?? {};
    expect(after).not.toHaveProperty('encrypted_credentials');
    // Non-secret columns are still captured.
    expect(after.source).toBe('qbo');
    expect(row?.entity_id).toBe(SC);
  });
});
