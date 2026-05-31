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
