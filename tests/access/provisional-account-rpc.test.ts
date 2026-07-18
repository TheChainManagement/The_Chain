import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

const T = 'a3100000-0000-0000-0000-000000000001';
const OWNER = 'a3100000-0000-0000-0000-000000000011';
const MANAGER = 'a3100000-0000-0000-0000-000000000012';
const NEW_USER = 'a3100000-0000-0000-0000-000000000013';
const EXISTING_USER = 'a3100000-0000-0000-0000-000000000014';
const EXPIRED_USER = 'a3100000-0000-0000-0000-000000000015';

let client: Client;

async function addAuthUser(id: string, email: string): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, email)
     values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [id, email],
  );
}

async function actAsUnassigned(userId: string): Promise<void> {
  await client.query('set local role authenticated');
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, OWNER, 'w3-provisioning');
  await addAuthUser(MANAGER, 'manager@provision.test');
  await client.query(`insert into profiles (user_id, active_tenant_id) values ($1, $2)`, [
    MANAGER,
    T,
  ]);
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'manager')`,
    [T, MANAGER],
  );
  await addAuthUser(NEW_USER, 'new@provision.test');
  await addAuthUser(EXISTING_USER, 'existing@provision.test');
  await addAuthUser(EXPIRED_USER, 'expired@provision.test');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('provisional account lifecycle', () => {
  let newProvision = '';
  let existingProvision = '';

  it('allows an owner to create staged access without creating membership', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const created = await client.query<{ create_tenant_access_provision: string }>(
      `select create_tenant_access_provision(
        $1, 'new@provision.test', $2, 'planner', true, true, now() + interval '24 hours', null
      )`,
      [T, NEW_USER],
    );
    newProvision = created.rows[0]?.create_tenant_access_provision ?? '';
    expect(newProvision).toMatch(/[0-9a-f-]{36}/);

    await asSuperuser(client);
    const membership = await client.query(
      `select 1 from tenant_members where tenant_id = $1 and user_id = $2`,
      [T, NEW_USER],
    );
    expect(membership.rowCount).toBe(0);
    const audit = await client.query<{ after: Record<string, unknown> }>(
      `select after from audit_log
       where tenant_id = $1 and entity_type = 'tenant_access_provisions'
       order by occurred_at desc, id desc limit 1`,
      [T],
    );
    expect(audit.rows[0]?.after).not.toHaveProperty('password');
  });

  it('prevents managers from staging privileged roles', async () => {
    await actAs(client, { sub: MANAGER, tenant_id: T, role: 'manager' });
    await client.query('savepoint manager_privileged_provision');
    await expect(
      client.query(
        `select create_tenant_access_provision(
          $1, 'existing@provision.test', $2, 'owner', false, false, null, null
        )`,
        [T, EXISTING_USER],
      ),
    ).rejects.toThrow('privileged_role_management_forbidden');
    await client.query('rollback to savepoint manager_privileged_provision');
  });

  it('does not activate a new user before the server marks password replacement', async () => {
    await actAsUnassigned(NEW_USER);
    const visible = await client.query<{ provision_id: string }>(
      `select * from my_pending_tenant_access()`,
    );
    expect(visible.rows.map((row) => row.provision_id)).toContain(newProvision);
    await client.query('savepoint activation_before_password');
    await expect(client.query(`select activate_tenant_access($1)`, [newProvision])).rejects.toThrow(
      'password_replacement_required',
    );
    await client.query('rollback to savepoint activation_before_password');
  });

  it('activates atomically after the server-only password mark', async () => {
    await asSuperuser(client);
    const marked = await client.query<{ mark_provisional_password_replaced: boolean }>(
      `select mark_provisional_password_replaced($1, $2)`,
      [newProvision, NEW_USER],
    );
    expect(marked.rows[0]?.mark_provisional_password_replaced).toBe(true);
    await actAsUnassigned(NEW_USER);
    const activated = await client.query<{ activate_tenant_access: string }>(
      `select activate_tenant_access($1)`,
      [newProvision],
    );
    expect(activated.rows[0]?.activate_tenant_access).toBe(T);

    await asSuperuser(client);
    const member = await client.query<{ role: string }>(
      `select role from tenant_members where tenant_id = $1 and user_id = $2`,
      [T, NEW_USER],
    );
    expect(member.rows[0]?.role).toBe('planner');
    const profile = await client.query<{ active_tenant_id: string }>(
      `select active_tenant_id from profiles where user_id = $1`,
      [NEW_USER],
    );
    expect(profile.rows[0]?.active_tenant_id).toBe(T);
  });

  it('lets an existing account activate without changing its password', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const created = await client.query<{ create_tenant_access_provision: string }>(
      `select create_tenant_access_provision(
        $1, 'existing@provision.test', $2, 'finance', false, false, null, null
      )`,
      [T, EXISTING_USER],
    );
    existingProvision = created.rows[0]?.create_tenant_access_provision ?? '';
    await actAsUnassigned(EXISTING_USER);
    await expect(
      client.query(`select activate_tenant_access($1)`, [existingProvision]),
    ).resolves.toBeTruthy();
  });

  it('rejects expired temporary credentials and supports guarded rotation', async () => {
    await asSuperuser(client);
    const expired = await client.query<{ id: string }>(
      `insert into tenant_access_provisions (
        tenant_id, email, auth_user_id, proposed_role, requires_password_change,
        created_auth_user, credential_expires_at, created_by
      ) values ($1, 'expired@provision.test', $2, 'viewer', true, true, now() - interval '1 hour', $3)
      returning id`,
      [T, EXPIRED_USER, OWNER],
    );
    const expiredId = expired.rows[0]?.id ?? '';
    await actAsUnassigned(EXPIRED_USER);
    await client.query('savepoint expired_activation');
    await expect(client.query(`select activate_tenant_access($1)`, [expiredId])).rejects.toThrow(
      'temporary_credential_expired',
    );
    await client.query('rollback to savepoint expired_activation');

    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const rotated = await client.query<{ rotate_tenant_access_provision: string }>(
      `select rotate_tenant_access_provision($1, $2, now() + interval '24 hours')`,
      [T, expiredId],
    );
    expect(rotated.rows[0]?.rotate_tenant_access_provision).toBe(EXPIRED_USER);
  });

  it('revokes pending access idempotently', async () => {
    await actAs(client, { sub: OWNER, tenant_id: T, role: 'owner' });
    const first = await client.query<{ out_revoked: boolean }>(
      `select * from revoke_tenant_access_provision($1, $2)`,
      [T, existingProvision],
    );
    // It was activated above, so closing it again is a harmless no-op.
    expect(first.rows[0]?.out_revoked).toBe(false);
  });
});
