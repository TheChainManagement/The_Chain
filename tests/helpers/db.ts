import { Client } from 'pg';

/**
 * Local Supabase Postgres connection for foundation DB tests.
 *
 * Defaults to the `supabase start` superuser DSN (bypasses RLS — correct for
 * audit-trigger tests, which assert the dispatcher writes rows regardless of
 * caller). RLS probes at 5I will connect as `authenticated` with a signed JWT
 * instead. Override with SUPABASE_DB_URL for CI.
 */
export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/**
 * Simulate a Supabase authenticated request inside the current transaction:
 * become the `authenticated` role and set the JWT claims GUC that `auth.jwt()`,
 * `auth.uid()`, `jwt_tenant_id()`, and `has_role()` read. RLS then applies
 * exactly as it would for a real signed-in user. Scoped with `set local`, so it
 * lasts until the next `asSuperuser()` or transaction end.
 */
export async function actAs(
  client: Client,
  claims: { sub?: string; tenant_id: string; role: string },
): Promise<void> {
  await client.query('set local role authenticated');
  // Mirror the real post-5L token shape: PostgREST's reserved `role` claim stays
  // `authenticated` (the DB role), and the member role rides in `tenant_role`
  // (what jwt_role() reads). The `role` field of the param is the MEMBER role for
  // caller convenience, so map it onto `tenant_role` here.
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({
      sub: claims.sub,
      tenant_id: claims.tenant_id,
      role: 'authenticated',
      tenant_role: claims.role,
    }),
  ]);
}

/** Drop back to the superuser (bypasses RLS) for seeding / cleanup. */
export async function asSuperuser(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', '', true)");
}
