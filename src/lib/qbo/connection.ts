import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QBO_CAPABILITIES } from './capabilities';
import { decryptJson, encryptJson } from './crypto';
import type { OAuthTokens } from './oauth';

/**
 * QBO connection persistence (Block 6 Wave 6.2). All writes go through the
 * service-role admin client, authorized at the action/route gate (the OAuth
 * callback and the sync factory are the only callers). Tokens are encrypted
 * app-side and stored via the bytea<->base64 RPCs from the migration.
 */

export interface StoredCredentials extends OAuthTokens {
  realmId: string;
}

export interface QboConnectionRecord {
  connectionId: string;
  realmId: string;
  credentials: StoredCredentials;
}

export interface QboStatus {
  connected: boolean;
  realmId?: string;
  lastSyncedAt?: string | null;
}

/**
 * Upsert the tenant's QBO connection with freshly encrypted tokens.
 *
 * Ordering matters: a NEW row is created `connecting`, the credentials are
 * written, and only then is it flipped to `active`. So `status='active'` always
 * implies credentials are present — a failed credential write can never leave a
 * half-connected row that `getQboStatus` would report as connected. An existing
 * row keeps its prior credentials if the new write fails.
 */
export async function saveQboConnection(
  admin: SupabaseClient,
  p: { tenantId: string; realmId: string; credentials: StoredCredentials },
): Promise<string> {
  const { data: existing } = await admin
    .from('source_connections')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('source', 'qbo')
    .limit(1)
    .maybeSingle<{ id: string }>();

  let connectionId = existing?.id;
  if (!connectionId) {
    const { data, error } = await admin
      .from('source_connections')
      .insert({
        tenant_id: p.tenantId,
        source: 'qbo',
        status: 'connecting',
        external_account_id: p.realmId,
        capabilities: QBO_CAPABILITIES,
      })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) {
      throw new Error(`Could not create the QuickBooks connection: ${error?.message ?? 'unknown'}`);
    }
    connectionId = data.id;
  }

  // Credentials first — a failure here leaves a new row 'connecting' (not
  // connected) and an existing row on its prior credentials.
  const { error: credErr } = await admin.rpc('set_qbo_credentials', {
    p_connection: connectionId,
    p_b64: encryptJson(p.credentials),
  });
  if (credErr) throw new Error(`Could not store QuickBooks credentials: ${credErr.message}`);

  // Now safe to mark active + refresh metadata.
  const { error: actErr } = await admin
    .from('source_connections')
    .update({ status: 'active', external_account_id: p.realmId, capabilities: QBO_CAPABILITIES })
    .eq('id', connectionId);
  if (actErr) throw new Error(`Could not activate the QuickBooks connection: ${actErr.message}`);

  return connectionId;
}

/** Load + decrypt the tenant's active QBO connection, or null if none. */
export async function loadQboConnection(
  admin: SupabaseClient,
  tenantId: string,
): Promise<QboConnectionRecord | null> {
  const { data: row } = await admin
    .from('source_connections')
    .select('id, external_account_id')
    .eq('tenant_id', tenantId)
    .eq('source', 'qbo')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string; external_account_id: string | null }>();
  if (!row) return null;

  const { data: b64 } = await admin.rpc('get_qbo_credentials', { p_connection: row.id });
  if (!b64 || typeof b64 !== 'string') return null;

  const credentials = decryptJson<StoredCredentials>(b64);
  return {
    connectionId: row.id,
    realmId: row.external_account_id ?? credentials.realmId,
    credentials,
  };
}

/** Stamp a successful sync. */
export async function markConnectionSynced(
  admin: SupabaseClient,
  connectionId: string,
  whenIso: string,
): Promise<void> {
  await admin.from('source_connections').update({ last_synced_at: whenIso }).eq('id', connectionId);
}

/** Tenant-scoped status for the UI (read through the caller's RLS client). */
export async function getQboStatus(
  tenantClient: SupabaseClient,
  tenantId: string,
): Promise<QboStatus> {
  const { data } = await tenantClient
    .from('source_connections')
    .select('external_account_id, status, last_synced_at')
    .eq('tenant_id', tenantId)
    .eq('source', 'qbo')
    .limit(1)
    .maybeSingle<{
      external_account_id: string | null;
      status: string;
      last_synced_at: string | null;
    }>();

  if (data?.status !== 'active') return { connected: false };
  return {
    connected: true,
    realmId: data.external_account_id ?? undefined,
    lastSyncedAt: data.last_synced_at,
  };
}

/** Mark the connection inactive on disconnect (tenant data is left intact). */
export async function deactivateQboConnection(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  await admin
    .from('source_connections')
    .update({ status: 'expired' })
    .eq('tenant_id', tenantId)
    .eq('source', 'qbo');
}
