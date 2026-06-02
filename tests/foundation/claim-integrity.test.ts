import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, asSuperuser, connect } from '../helpers/db';
import { seedTenant } from '../helpers/seed';

/**
 * Tenant-claim integrity (Codex BLOCKER 1 + 2, 2026-05-31).
 *
 * The earlier cross-tenant probe injected JWT claims directly, so it never
 * exercised how claims are MINTED. These tests close that gap: a user must not
 * be able to grant themselves a tenant_id claim for a tenant they don't belong
 * to, and a removed member must not regain one on re-login.
 */

const A = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const UA = 'e0000000-0000-0000-0000-0000000000ea';
const B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const UB = 'f0000000-0000-0000-0000-0000000000fb';

let client: Client;

async function hookTenantClaim(userId: string): Promise<string | null> {
  const { rows } = await client.query<{ tid: string | null }>(
    `select (public.custom_access_token_hook(
        jsonb_build_object('user_id', $1::uuid, 'claims', '{}'::jsonb)
     ) -> 'claims' ->> 'tenant_id') as tid`,
    [userId],
  );
  return rows[0]?.tid ?? null;
}

// Full claims object the hook emits, given the base claims Supabase passes in.
async function hookClaims(
  userId: string,
  base: Record<string, unknown> = { role: 'authenticated' },
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query<{ claims: Record<string, unknown> }>(
    `select (public.custom_access_token_hook(
        jsonb_build_object('user_id', $1::uuid, 'claims', $2::jsonb)
     ) -> 'claims') as claims`,
    [userId, JSON.stringify(base)],
  );
  return rows[0]?.claims ?? null;
}

beforeAll(async () => {
  client = await connect();
  await client.query('begin');
  await seedTenant(client, A, UA, 'ea');
  await seedTenant(client, B, UB, 'fb');
}, 60_000);

afterAll(async () => {
  if (client) {
    await asSuperuser(client);
    await client.query('rollback');
    await client.end();
  }
});

describe('profiles.active_tenant_id cannot point at a tenant you do not belong to', () => {
  it('rejects setting active_tenant_id to another tenant', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    await client.query('savepoint spoof');
    await expect(
      client.query(`update public.profiles set active_tenant_id = $1 where user_id = $2`, [B, UA]),
    ).rejects.toThrow(/row-level security/i);
    await client.query('rollback to savepoint spoof');
    await asSuperuser(client);
  });

  it('allows setting active_tenant_id to a tenant you DO belong to', async () => {
    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    const res = await client.query(
      `update public.profiles set active_tenant_id = $1 where user_id = $2`,
      [A, UA],
    );
    expect(res.rowCount).toBe(1);
    await asSuperuser(client);
  });
});

describe('the access-token hook only mints tenant claims when membership is real', () => {
  it('a spoofed active_tenant_id (no membership) yields NO tenant_id claim', async () => {
    // Force the spoof at the data layer (as if RLS had been bypassed somehow).
    await client.query(`update public.profiles set active_tenant_id = $1 where user_id = $2`, [B, UA]);
    expect(await hookTenantClaim(UA)).toBeNull();
  });

  it('a real membership yields the tenant_id claim', async () => {
    await client.query(`update public.profiles set active_tenant_id = $1 where user_id = $2`, [A, UA]);
    expect(await hookTenantClaim(UA)).toBe(A);
  });

  // 5L regression: the member role must ride in `tenant_role`, NEVER in the
  // reserved top-level `role` claim. PostgREST runs `SET ROLE <role>` per
  // request; writing `role='owner'` makes every authenticated query fail with
  // `role "owner" does not exist`. This is the exact bug that bounced all logins.
  it('mints the member role as tenant_role and leaves the reserved role as authenticated (5L)', async () => {
    await client.query(`update public.profiles set active_tenant_id = $1 where user_id = $2`, [A, UA]);
    const claims = await hookClaims(UA, { role: 'authenticated' });
    expect(claims?.tenant_role).toBe('owner');
    expect(claims?.role).toBe('authenticated');
    expect(claims?.tenant_id).toBe(A);
  });

  it('a removed member gets NO tenant_id claim on re-login', async () => {
    await client.query(`update public.profiles set active_tenant_id = $1 where user_id = $2`, [A, UA]);
    await client.query(`delete from public.tenant_members where tenant_id = $1 and user_id = $2`, [A, UA]);
    expect(await hookTenantClaim(UA)).toBeNull();
  });
});

describe('a PO cannot reference another tenant’s recommendation', () => {
  it('rejects a purchase_order whose recommendation_id belongs to tenant B', async () => {
    await asSuperuser(client);
    const aIds = await client.query<{ s: string; l: string }>(
      `select (select id from suppliers where tenant_id = $1 limit 1) as s,
              (select id from locations where tenant_id = $1 limit 1) as l`,
      [A],
    );
    const bRec = await client.query<{ id: string }>(
      `select id from reorder_recommendations where tenant_id = $1 limit 1`,
      [B],
    );

    await actAs(client, { sub: UA, tenant_id: A, role: 'owner' });
    await client.query('savepoint poref');
    await expect(
      client.query(
        `insert into public.purchase_orders (tenant_id, supplier_id, location_id, status, recommendation_id)
         values ($1, $2, $3, 'draft', $4)`,
        [A, aIds.rows[0]?.s, aIds.rows[0]?.l, bRec.rows[0]?.id],
      ),
    ).rejects.toThrow(/tenant/i);
    await client.query('rollback to savepoint poref');
    await asSuperuser(client);
  });
});
