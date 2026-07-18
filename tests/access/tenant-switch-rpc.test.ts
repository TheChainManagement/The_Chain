import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * W3-2 active-tenant switch (DB probes). Membership in the TARGET tenant is the
 * gate: a person in two companies can move between them, a person with no
 * membership cannot switch into one, and an unauthenticated call is rejected.
 * The switch only moves profiles.active_tenant_id; the token hook re-mints claims
 * on the caller's next session refresh.
 */

const T = 'a3100000-0000-0000-0000-000000000001';
const OTHER_T = 'a3100000-0000-0000-0000-000000000002';
const OWNER = 'a3100000-0000-0000-0000-000000000011';
const OTHER_OWNER = 'a3100000-0000-0000-0000-000000000021';
// Belongs to BOTH tenants (planner in T, viewer in OTHER_T); active starts on T.
const MULTI = 'a3100000-0000-0000-0000-000000000031';
// Belongs to T only.
const LONER = 'a3100000-0000-0000-0000-000000000041';

let client: Client;

async function addMember(userId: string, email: string): Promise<void> {
  await client.query(
    `insert into auth.users (id, instance_id, email)
     values ($1, '00000000-0000-0000-0000-000000000000', $2)`,
    [userId, email],
  );
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, T, OWNER, 'w3sw-a');
  await seedTenant(client, OTHER_T, OTHER_OWNER, 'w3sw-b');

  await addMember(MULTI, 'multi@example.test');
  await client.query(`insert into profiles (user_id, active_tenant_id) values ($1, $2)`, [
    MULTI,
    T,
  ]);
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'planner')`,
    [T, MULTI],
  );
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer')`,
    [OTHER_T, MULTI],
  );

  await addMember(LONER, 'loner@example.test');
  await client.query(`insert into profiles (user_id, active_tenant_id) values ($1, $2)`, [
    LONER,
    T,
  ]);
  await client.query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'warehouse')`,
    [T, LONER],
  );
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('switch_active_tenant', () => {
  it('keeps both helpers definer-hardened with empty search paths and narrow grants', async () => {
    await asSuperuser(client);
    const functions = await client.query<{
      name: string;
      security_definer: boolean;
      config: string[] | null;
      direct_acl: string;
      public_execute: boolean;
      authenticated_execute: boolean;
    }>(
      `select p.proname as name,
              p.prosecdef as security_definer,
              p.proconfig as config,
              p.proacl::text as direct_acl,
              has_function_privilege('public', p.oid, 'execute') as public_execute,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('switch_active_tenant', 'my_tenant_memberships')
       order by p.proname`,
    );
    expect(functions.rows).toHaveLength(2);
    for (const row of functions.rows) {
      expect(row.security_definer, row.name).toBe(true);
      expect(row.config, row.name).toContain('search_path=""');
      expect(row.direct_acl, row.name).toContain('authenticated=X');
      expect(row.direct_acl, row.name).not.toContain('anon=X');
      expect(row.public_execute, row.name).toBe(false);
      expect(row.authenticated_execute, row.name).toBe(true);
    }
  });

  it('moves a multi-tenant member into a tenant they belong to and returns that role', async () => {
    await actAs(client, { sub: MULTI, tenant_id: T, role: 'planner' });
    const res = await client.query<{ out_tenant_id: string; out_role: string }>(
      `select * from switch_active_tenant($1)`,
      [OTHER_T],
    );
    expect(res.rows[0]?.out_tenant_id).toBe(OTHER_T);
    expect(res.rows[0]?.out_role).toBe('viewer');

    await asSuperuser(client);
    const profile = await client.query<{ active_tenant_id: string }>(
      `select active_tenant_id from profiles where user_id = $1`,
      [MULTI],
    );
    expect(profile.rows[0]?.active_tenant_id).toBe(OTHER_T);
    const audit = await client.query<{ count: number }>(
      `select count(*)::int as count from audit_log
       where tenant_id = $1 and action = 'tenant_context.switch'
         and actor_user_id = $2`,
      [OTHER_T, MULTI],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('rejects a switch into a tenant the caller does not belong to and leaves context intact', async () => {
    await actAs(client, { sub: LONER, tenant_id: T, role: 'warehouse' });
    await client.query('savepoint no_member_switch');
    await expect(client.query(`select * from switch_active_tenant($1)`, [OTHER_T])).rejects.toThrow(
      /tenant_membership_required/,
    );
    await client.query('rollback to savepoint no_member_switch');

    await asSuperuser(client);
    const profile = await client.query<{ active_tenant_id: string }>(
      `select active_tenant_id from profiles where user_id = $1`,
      [LONER],
    );
    expect(profile.rows[0]?.active_tenant_id).toBe(T);
  });

  it('rejects an unauthenticated switch', async () => {
    await asSuperuser(client);
    await client.query('savepoint unauth_switch');
    await expect(client.query(`select * from switch_active_tenant($1)`, [OTHER_T])).rejects.toThrow(
      /switch_auth_required/,
    );
    await client.query('rollback to savepoint unauth_switch');
  });
});

describe('my_tenant_memberships', () => {
  it('lists every tenant the caller belongs to, ordered by name', async () => {
    await actAs(client, { sub: MULTI, tenant_id: T, role: 'planner' });
    const res = await client.query<{ tenant_id: string; tenant_name: string; role: string }>(
      `select * from my_tenant_memberships()`,
    );
    expect(res.rows).toHaveLength(2);
    const byTenant = new Map(res.rows.map((r) => [r.tenant_id, r.role]));
    expect(byTenant.get(T)).toBe('planner');
    expect(byTenant.get(OTHER_T)).toBe('viewer');
    // Ordered by tenant name ("Tenant w3sw-a" before "Tenant w3sw-b").
    const names = res.rows.map((r) => r.tenant_name);
    expect([...names]).toEqual([...names].sort());
  });

  it('returns only the caller-owned tenant for a single-tenant member', async () => {
    await actAs(client, { sub: LONER, tenant_id: T, role: 'warehouse' });
    const res = await client.query<{ tenant_id: string }>(`select * from my_tenant_memberships()`);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.tenant_id).toBe(T);
  });
});
