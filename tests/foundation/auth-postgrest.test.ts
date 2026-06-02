import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 5L regression — the REAL failure path (Codex finding, 2026-06-01).
 *
 * Every other foundation test reaches Postgres through the pg superuser harness
 * with `set local role authenticated` + an injected `request.jwt.claims` GUC.
 * That short-circuits the exact mechanism that broke production: PostgREST mints
 * a token, then runs `SET ROLE <role-claim>` for every request. The pre-5L hook
 * wrote the member role into `role`, so PostgREST ran `SET ROLE owner` and every
 * authenticated query died with `role "owner" does not exist` — bouncing all
 * logins to /signin.
 *
 * This test exercises the live path end to end: real user -> signInWithPassword
 * -> minted JWT -> authenticated PostgREST request -> SET ROLE. It would fail
 * against the pre-5L hook. Requires the local Supabase stack (`supabase start`).
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const EMAIL = 'it-5l-postgrest@bayou-it.example';
const PASSWORD = 'integration-5l-pw';

const admin: SupabaseClient = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId: string | undefined;
let tenantId: string | undefined;

async function findTestUserId(): Promise<string | undefined> {
  // Local can accumulate many test users, so paginate rather than trusting page 1.
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === EMAIL);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

async function deleteTestUser(): Promise<void> {
  const id = await findTestUserId();
  if (id) await admin.auth.admin.deleteUser(id);
}

beforeAll(async () => {
  await deleteTestUser(); // idempotent across runs
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    // Tolerate a residual user from an aborted run: reuse it.
    userId = await findTestUserId();
    if (!userId) throw error;
  } else {
    userId = data.user.id;
  }
}, 60_000);

afterAll(async () => {
  // Deleting the user cascades tenant_members + profiles (FK on delete cascade).
  // The tenant + subscription have no cascade from auth.users, so clean them via
  // the service role (bypasses RLS). Leftovers are local-only and wiped on reset.
  await deleteTestUser();
  if (tenantId) {
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
});

describe('5L: a real minted token survives an authenticated PostgREST request', () => {
  it('signs in, bootstraps, and runs a tenant-scoped query without a SET ROLE failure', async () => {
    const user = createClient(URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signIn = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    expect(signIn.error).toBeNull();

    // Mirror real signup: the authenticated user creates its own tenant graph.
    const boot = await user.rpc('bootstrap_tenant', { p_business_name: 'Integration Co 5L' });
    expect(boot.error).toBeNull();

    // Re-mint so the hook attaches tenant claims now that membership exists.
    await user.auth.refreshSession();
    const { data: claimsData } = await user.auth.getClaims();
    const claims = (claimsData?.claims ?? {}) as Record<string, unknown>;

    // The 5L invariant, observed on a real token:
    expect(claims.role).toBe('authenticated'); // PostgREST-reserved claim intact
    expect(claims.tenant_role).toBe('owner'); // member role lives here instead
    tenantId = claims.tenant_id as string;
    expect(tenantId).toBeTruthy();

    // THE failure path: an authenticated PostgREST query triggers SET ROLE.
    // Pre-5L this errored with `role "owner" does not exist` and returned null.
    const scoped = await user
      .from('tenant_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    expect(scoped.error).toBeNull();
    expect(scoped.count).toBe(1);
  }, 60_000);
});
