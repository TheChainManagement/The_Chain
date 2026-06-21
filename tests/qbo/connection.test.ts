import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deactivateQboConnection,
  getQboStatus,
  loadQboConnection,
  type StoredCredentials,
  saveQboConnection,
} from '@/lib/qbo/connection';
import { connect } from '../helpers/db';

/**
 * Connection-layer integration test (Block 6 Wave 6.2). Exercises the real
 * service-role path against local Supabase: the bytea<->base64 RPCs, app-side
 * AES round-trip, the persistence ordering (active ⇒ creds present), status, and
 * deactivate. Requires `supabase start` + .env.local (loaded by tests/setup.ts).
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin: SupabaseClient = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const creds: StoredCredentials = {
  accessToken: 'AT-secret-value',
  refreshToken: 'RT-secret-value',
  expiresIn: 3600,
  refreshExpiresIn: 8_726_400,
  obtainedAt: '2026-06-05T00:00:00.000Z',
  realmId: 'REALM-1',
};

let pg: Client;
let tenantId: string;

beforeAll(async () => {
  pg = await connect();
  const r = await pg.query<{ id: string }>(
    "insert into tenants (name, slug) values ('qbo-conn-test', 'qbo-conn-test-" +
      Math.floor(Date.now() % 1e9) +
      "') returning id",
  );
  tenantId = r.rows[0]!.id;
}, 30_000);

afterAll(async () => {
  // Delete source_connections first (its own delete fires a 5F audit trigger),
  // THEN clear audit_log, so no audit row referencing the tenant survives to
  // trip audit_log_tenant_id_fkey on the tenant delete.
  await pg.query('delete from source_connections where tenant_id = $1', [tenantId]);
  await pg.query('delete from audit_log where tenant_id = $1', [tenantId]);
  await pg.query('delete from tenants where id = $1', [tenantId]);
  await pg.end();
});

describe('qbo connection layer (service-role)', () => {
  it('saves an encrypted connection and round-trips it decrypted', async () => {
    const id = await saveQboConnection(admin, { tenantId, realmId: 'REALM-1', credentials: creds });
    expect(id).toBeTruthy();

    const loaded = await loadQboConnection(admin, tenantId);
    expect(loaded?.realmId).toBe('REALM-1');
    expect(loaded?.credentials.accessToken).toBe('AT-secret-value');
    expect(loaded?.credentials.refreshToken).toBe('RT-secret-value');
  });

  it('stores ciphertext at rest, not the plaintext tokens', async () => {
    const raw = await pg.query<{ b: string }>(
      "select encode(encrypted_credentials, 'base64') b from source_connections where tenant_id = $1 and source = 'qbo'",
      [tenantId],
    );
    const blob = Buffer.from(raw.rows[0]!.b, 'base64').toString('utf8');
    expect(blob).not.toContain('AT-secret-value');
    expect(blob).not.toContain('RT-secret-value');
  });

  it('reports connected status with the realmId', async () => {
    const status = await getQboStatus(admin, tenantId);
    expect(status.connected).toBe(true);
    expect(status.realmId).toBe('REALM-1');
  });

  it('re-save (token refresh) keeps a single active connection', async () => {
    const next = { ...creds, accessToken: 'AT-rotated' };
    await saveQboConnection(admin, { tenantId, realmId: 'REALM-1', credentials: next });
    const { count } = await admin
      .from('source_connections')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('source', 'qbo');
    expect(count).toBe(1);
    const loaded = await loadQboConnection(admin, tenantId);
    expect(loaded?.credentials.accessToken).toBe('AT-rotated');
  });

  it('deactivate flips status to not-connected (data intact)', async () => {
    await deactivateQboConnection(admin, tenantId);
    expect((await getQboStatus(admin, tenantId)).connected).toBe(false);
    // loadQboConnection only returns active connections.
    expect(await loadQboConnection(admin, tenantId)).toBeNull();
  });
});
