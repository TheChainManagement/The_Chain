import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { qboEnv } from '@/lib/env';
import { QboSourceAdapter } from './adapter';
import { QboClient } from './client';
import { loadQboConnection, type StoredCredentials, saveQboConnection } from './connection';
import { fetchTokenHttp, refreshAccessToken } from './oauth';
import { HttpQboTransport } from './transport';

/**
 * Build a ready `QboSourceAdapter` for a tenant's stored connection (Block 6
 * Wave 6.2). Refreshes the access token if it's within the skew window of
 * expiry and persists the rotated tokens, so callers (sync action, future cron)
 * never deal with token lifecycle. Returns null if the tenant isn't connected.
 */

const REFRESH_SKEW_SEC = 120;

export interface QboAdapterHandle {
  adapter: QboSourceAdapter;
  connectionId: string;
  realmId: string;
}

export async function createQboAdapterForTenant(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<QboAdapterHandle | null> {
  const conn = await loadQboConnection(admin, tenantId);
  if (!conn) return null;

  const env = qboEnv();
  let creds: StoredCredentials = conn.credentials;

  const expiresAtMs = new Date(creds.obtainedAt).getTime() + creds.expiresIn * 1000;
  if (nowMs >= expiresAtMs - REFRESH_SKEW_SEC * 1000) {
    const refreshed = await refreshAccessToken(fetchTokenHttp, {
      clientId: env.QBO_CLIENT_ID,
      clientSecret: env.QBO_CLIENT_SECRET,
      refreshToken: creds.refreshToken,
      nowIso: new Date(nowMs).toISOString(),
    });
    creds = { ...refreshed, realmId: conn.realmId };
    await saveQboConnection(admin, { tenantId, realmId: conn.realmId, credentials: creds });
  }

  const client = new QboClient(
    { realmId: conn.realmId, environment: env.QBO_ENVIRONMENT },
    // Token read lazily so a mid-flight refresh is picked up without rebuilding.
    new HttpQboTransport(() => creds.accessToken),
  );
  return {
    adapter: new QboSourceAdapter(client, tenantId),
    connectionId: conn.connectionId,
    realmId: conn.realmId,
  };
}
