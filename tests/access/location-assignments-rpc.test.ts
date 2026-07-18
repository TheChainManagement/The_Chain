import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'a3200000-0000-0000-0000-000000000001';
const OTHER_T = 'a3200000-0000-0000-0000-000000000002';
const OWNER = 'a3200000-0000-0000-0000-000000000011';
const MANAGER = 'a3200000-0000-0000-0000-000000000012';
const PLANNER = 'a3200000-0000-0000-0000-000000000013';
const VIEWER = 'a3200000-0000-0000-0000-000000000014';
const OTHER_OWNER = 'a3200000-0000-0000-0000-000000000021';
let assignedLocation: string;
let hiddenLocation: string;
let finalAssignmentLocation: string;
let client: Client;

async function addMember(userId: string, role: string): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, email)
     values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [userId, `${role}-${userId.slice(-4)}@example.test`],
  );
  await client.query('insert into profiles (user_id, active_tenant_id) values ($1, $2)', [
    userId,
    T,
  ]);
  await client.query(
    'insert into tenant_members (tenant_id, user_id, role) values ($1, $2, $3::member_role)',
    [T, userId, role],
  );
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, OWNER, 'w3-locations');
  await seedTenant(client, OTHER_T, OTHER_OWNER, 'w3-locations-other');
  await addMember(MANAGER, 'manager');
  await addMember(PLANNER, 'planner');
  await addMember(VIEWER, 'viewer');
  const locations = await client.query<{ id: string }>(
    `select id from locations where tenant_id = $1 order by created_at limit 1`,
    [T],
  );
  assignedLocation = locations.rows[0]?.id ?? '';
  const hidden = await client.query<{ id: string }>(
    `insert into locations (tenant_id, name, type)
     values ($1, 'Restricted annex', 'warehouse') returning id`,
    [T],
  );
  hiddenLocation = hidden.rows[0]?.id ?? '';
  const finalLocation = await client.query<{ id: string }>(
    `insert into locations (tenant_id, name, type)
     values ($1, 'Viewer-only depot', 'warehouse') returning id`,
    [T],
  );
  finalAssignmentLocation = finalLocation.rows[0]?.id ?? '';
  await client.query(
    `insert into tenant_member_locations (tenant_id, user_id, location_id)
     values ($1, $2, $3)`,
    [T, VIEWER, finalAssignmentLocation],
  );
  await client.query(
    'update tenant_members set all_locations = false where tenant_id = $1 and user_id = $2',
    [T, VIEWER],
  );
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('W3-3 guarded assignment contract', () => {
  it('defaults existing members to all locations and scopes a lower role atomically', async () => {
    await asSuperuser(client);
    const before = await client.query<{ all_locations: boolean }>(
      'select all_locations from tenant_members where tenant_id = $1 and user_id = $2',
      [T, PLANNER],
    );
    expect(before.rows[0]?.all_locations).toBe(true);

    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const result = await client.query<{ out_all_locations: boolean; out_location_count: number }>(
      'select * from set_tenant_member_location_access($1, $2, false, $3::uuid[])',
      [T, PLANNER, [assignedLocation]],
    );
    expect(result.rows[0]).toMatchObject({ out_all_locations: false, out_location_count: 1 });
  });

  it('lets managers scope lower roles but rejects self, privileged, and cross-tenant targets', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    for (const [name, tenant, member, message] of [
      ['self_scope', T, MANAGER, 'self_location_change_forbidden'],
      ['owner_scope', T, OWNER, 'privileged_role_management_forbidden'],
      ['cross_tenant', OTHER_T, OTHER_OWNER, 'membership_management_forbidden'],
    ] as const) {
      await client.query(`savepoint ${name}`);
      await expect(
        client.query('select * from set_tenant_member_location_access($1, $2, false, $3::uuid[])', [
          tenant,
          member,
          [assignedLocation],
        ]),
      ).rejects.toThrow(message);
      await client.query(`rollback to savepoint ${name}`);
    }
  });

  it('prevents removing the final active assignment and audits changes', async () => {
    await asSuperuser(client);
    await client.query('savepoint final_assignment');
    await client.query(
      'delete from tenant_member_locations where tenant_id = $1 and user_id = $2',
      [T, PLANNER],
    );
    await expect(client.query('set constraints all immediate')).rejects.toThrow(
      'final_location_assignment_required',
    );
    await client.query('rollback to savepoint final_assignment');
    const audit = await client.query<{ count: number }>(
      `select count(*)::int as count from audit_log
       where tenant_id = $1 and entity_type = 'tenant_member_locations'`,
      [T],
    );
    expect(audit.rows[0]?.count).toBeGreaterThan(0);
  });

  it('rejects direct assignment writes, cross-tenant locations, and scoped owners', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('savepoint direct_assignment');
    await expect(
      client.query(
        `insert into tenant_member_locations (tenant_id, user_id, location_id)
         values ($1, $2, $3)`,
        [T, PLANNER, hiddenLocation],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.query('rollback to savepoint direct_assignment');

    await asSuperuser(client);
    const otherLocation = await client.query<{ id: string }>(
      'select id from locations where tenant_id = $1 limit 1',
      [OTHER_T],
    );
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('savepoint cross_tenant_location');
    await expect(
      client.query('select * from set_tenant_member_location_access($1, $2, false, $3::uuid[])', [
        T,
        PLANNER,
        [otherLocation.rows[0]?.id],
      ]),
    ).rejects.toThrow('location_assignment_required');
    await client.query('rollback to savepoint cross_tenant_location');

    await asSuperuser(client);
    await client.query('savepoint scoped_owner');
    await expect(
      client.query(
        'update tenant_members set all_locations = false where tenant_id = $1 and user_id = $2',
        [T, OWNER],
      ),
    ).rejects.toThrow('privileged_member_requires_all_locations');
    await client.query('rollback to savepoint scoped_owner');

    await client.query('savepoint final_location_archive');
    await expect(
      client.query('update locations set active = false where tenant_id = $1 and id = $2', [
        T,
        finalAssignmentLocation,
      ]),
    ).rejects.toThrow('location_has_final_member_assignment');
    await client.query('rollback to savepoint final_location_archive');
  });
});

describe('W3-3 operational RLS', () => {
  it('shows only assigned locations and their inventory, policies, orders, RFQs, and requisitions', async () => {
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    const locations = await client.query<{ id: string }>('select id from locations order by id');
    expect(locations.rows).toEqual([{ id: assignedLocation }]);
    for (const table of [
      'inventory_levels',
      'inventory_policy',
      'reorder_recommendations',
      'purchase_orders',
      'cycle_count_sessions',
      'rfqs',
      'requisitions',
    ]) {
      const result = await client.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(result.rows[0]?.count, table).toBe(1);
    }
  });

  it('rejects direct writes and URL-shaped point reads at an unassigned location', async () => {
    await actAs(client, { sub: PLANNER, tenant_id: T, role: 'planner' });
    const hidden = await client.query('select id from locations where id = $1', [hiddenLocation]);
    expect(hidden.rows).toHaveLength(0);

    const supplier = await client.query<{ id: string }>('select id from suppliers limit 1');
    await client.query('savepoint hidden_po');
    await expect(
      client.query(
        `insert into purchase_orders (tenant_id, supplier_id, location_id)
         values ($1, $2, $3)`,
        [T, supplier.rows[0]?.id, hiddenLocation],
      ),
    ).rejects.toThrow(/row-level security|active location not found/i);
    await client.query('rollback to savepoint hidden_po');

    const levelWrite = await client.query(
      'update inventory_levels set on_hand = on_hand + 1 where tenant_id = $1',
      [T],
    );
    expect(levelWrite.rowCount).toBe(0);
  });

  it('keeps owners all-location regardless of assignment rows', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const result = await client.query<{ count: number }>(
      'select count(*)::int as count from locations where tenant_id = $1',
      [T],
    );
    expect(result.rows[0]?.count).toBe(3);
  });
});
