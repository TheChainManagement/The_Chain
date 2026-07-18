import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'a3000000-0000-0000-0000-000000000001';
const OTHER_T = 'a3000000-0000-0000-0000-000000000002';
const OWNER = 'a3000000-0000-0000-0000-000000000011';
const OWNER_2 = 'a3000000-0000-0000-0000-000000000012';
const MANAGER = 'a3000000-0000-0000-0000-000000000013';
const PLANNER = 'a3000000-0000-0000-0000-000000000014';
const VIEWER = 'a3000000-0000-0000-0000-000000000015';
const OTHER_OWNER = 'a3000000-0000-0000-0000-000000000021';

let client: Client;

async function addUser(userId: string, email: string, role: string): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, email)
     values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [userId, email],
  );
  await client.query(`insert into profiles (user_id, active_tenant_id) values ($1, $2)`, [
    userId,
    T,
  ]);
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, $3::member_role)`,
    [T, userId, role],
  );
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, OWNER, 'w3-access');
  await seedTenant(client, OTHER_T, OTHER_OWNER, 'w3-other');
  await addUser(OWNER_2, 'owner2@example.test', 'owner');
  await addUser(MANAGER, 'manager@example.test', 'manager');
  await addUser(PLANNER, 'planner@example.test', 'planner');
  await addUser(VIEWER, 'viewer@example.test', 'viewer');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('change_tenant_member_role', () => {
  it('allows an owner to manage another privileged member and bumps stale-token generation', async () => {
    await asSuperuser(client);
    const before = await client.query<{ token_generation: number }>(
      `select token_generation from tenants where id = $1`,
      [T],
    );
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const changed = await client.query<{ out_role: string; out_changed: boolean }>(
      `select * from change_tenant_member_role($1, $2, 'owner')`,
      [T, MANAGER],
    );
    expect(changed.rows[0]).toEqual({ out_user_id: MANAGER, out_role: 'owner', out_changed: true });

    await asSuperuser(client);
    const after = await client.query<{ token_generation: number }>(
      `select token_generation from tenants where id = $1`,
      [T],
    );
    expect(after.rows[0]?.token_generation).toBe((before.rows[0]?.token_generation ?? 0) + 1);
    await client.query(
      `update tenant_members set role = 'manager' where tenant_id = $1 and user_id = $2`,
      [T, MANAGER],
    );
  });

  it('allows a manager to move a lower member between lower roles', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    const changed = await client.query<{ out_role: string }>(
      `select * from change_tenant_member_role($1, $2, 'warehouse')`,
      [T, PLANNER],
    );
    expect(changed.rows[0]?.out_role).toBe('warehouse');
  });

  it('prevents a manager from granting or changing privileged roles', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query('savepoint manager_escalation');
    await expect(
      client.query(`select * from change_tenant_member_role($1, $2, 'manager')`, [T, VIEWER]),
    ).rejects.toThrow('privileged_role_management_forbidden');
    await client.query('rollback to savepoint manager_escalation');

    await client.query('savepoint manager_owner_change');
    await expect(
      client.query(`select * from change_tenant_member_role($1, $2, 'viewer')`, [T, OWNER_2]),
    ).rejects.toThrow('privileged_role_management_forbidden');
    await client.query('rollback to savepoint manager_owner_change');
  });

  it('prevents self-role changes and cross-tenant management', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('savepoint self_change');
    await expect(
      client.query(`select * from change_tenant_member_role($1, $2, 'viewer')`, [T, OWNER]),
    ).rejects.toThrow('self_role_change_forbidden');
    await client.query('rollback to savepoint self_change');

    await client.query('savepoint cross_tenant_change');
    await expect(
      client.query(`select * from change_tenant_member_role($1, $2, 'viewer')`, [
        OTHER_T,
        OTHER_OWNER,
      ]),
    ).rejects.toThrow('membership_management_forbidden');
    await client.query('rollback to savepoint cross_tenant_change');
  });
});

describe('remove_tenant_member', () => {
  it('lets a manager remove a lower member and clears active tenant state', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    const removed = await client.query<{ out_removed: boolean }>(
      `select * from remove_tenant_member($1, $2)`,
      [T, VIEWER],
    );
    expect(removed.rows[0]?.out_removed).toBe(true);
    await asSuperuser(client);
    const profile = await client.query<{ active_tenant_id: string | null }>(
      `select active_tenant_id from profiles where user_id = $1`,
      [VIEWER],
    );
    expect(profile.rows[0]?.active_tenant_id).toBeNull();
  });

  it('prevents self-removal and keeps at least one owner', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    await client.query('savepoint self_remove');
    await expect(
      client.query(`select * from remove_tenant_member($1, $2)`, [T, OWNER]),
    ).rejects.toThrow('self_removal_forbidden');
    await client.query('rollback to savepoint self_remove');

    const removed = await client.query<{ out_removed: boolean }>(
      `select * from remove_tenant_member($1, $2)`,
      [T, OWNER_2],
    );
    expect(removed.rows[0]?.out_removed).toBe(true);
    const ownerCount = await client.query<{ n: number }>(
      `select count(*)::int as n from tenant_members where tenant_id = $1 and role = 'owner'`,
      [T],
    );
    expect(ownerCount.rows[0]?.n).toBe(1);
  });

  it('is idempotent for an already absent lower member', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const replay = await client.query<{ out_removed: boolean }>(
      `select * from remove_tenant_member($1, $2)`,
      [T, VIEWER],
    );
    expect(replay.rows[0]?.out_removed).toBe(false);
  });
});

describe('direct membership writes', () => {
  it('are closed for authenticated owners and managers', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const update = await client.query(
      `update tenant_members set role = role where tenant_id = $1 and user_id = $2`,
      [T, MANAGER],
    );
    expect(update.rowCount).toBe(0);
    await client.query('savepoint direct_insert');
    await expect(
      client.query(
        `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer')`,
        [T, VIEWER],
      ),
    ).rejects.toThrow(/row-level security/i);
    await client.query('rollback to savepoint direct_insert');
  });
});
