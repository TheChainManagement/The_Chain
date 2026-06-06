'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { qboEnv } from '@/lib/env';
import { QboClient, QboSourceAdapter } from '@/lib/qbo';
import {
  deactivateQboConnection,
  loadQboConnection,
  markConnectionSynced,
} from '@/lib/qbo/connection';
import { createQboAdapterForTenant } from '@/lib/qbo/factory';
import { FixtureTransport } from '@/lib/qbo/fixtures';
import { buildAuthorizeUrl, fetchTokenHttp, revokeToken } from '@/lib/qbo/oauth';
import { type QboSyncOutcome, summarizeQboPull } from '@/lib/qbo/summary';
import { FatalError, RetryableError } from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * QBO connect + sync actions (Block 6 Wave 6.2).
 *
 * - `runQboSandboxSync` — read-only preview against fixtures (no creds, Wave 6.1).
 * - `startQboConnect` — owner/manager kicks the OAuth flow (CSRF state cookie).
 * - `runQboLiveSync` — read-only pull against the connected sandbox/company; the
 *   chain forms from the operator's real data. (Durable write-to-DB is Wave 6.2b.)
 * - `disconnectQbo` — revoke + deactivate; tenant data is left intact.
 *
 * The error catch maps the adapter taxonomy so the UI can tell rate-limit from
 * auth (an expired refresh token) from a generic fault.
 */

const STATE_COOKIE = 'qbo_oauth_state';
const PRIVILEGED = new Set(['owner', 'manager']);

async function tenantAndRole(): Promise<{ tenantId?: string; role?: string }> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return {
    tenantId: data?.claims?.tenant_id as string | undefined,
    role: data?.claims?.tenant_role as string | undefined,
  };
}

function mapSyncError(err: unknown): QboSyncOutcome {
  if (err instanceof RetryableError) {
    return { ok: false, error: 'QuickBooks is rate-limiting the request. Try again in a moment.' };
  }
  if (err instanceof FatalError) {
    return {
      ok: false,
      error:
        err.code === 'auth' || err.code === 'oauth'
          ? 'QuickBooks needs to be reconnected. The connection may have expired.'
          : 'QuickBooks returned an error while reading your data.',
    };
  }
  return { ok: false, error: 'The sync could not run. Please try again.' };
}

export async function runQboSandboxSync(): Promise<QboSyncOutcome> {
  const { tenantId } = await tenantAndRole();
  if (!tenantId)
    return { ok: false, error: 'Your session expired. Sign in again to preview a sync.' };

  try {
    const client = new QboClient(
      { realmId: 'sandbox', environment: 'sandbox' },
      new FixtureTransport(),
    );
    const result = await summarizeQboPull(new QboSourceAdapter(client, tenantId));
    return { ok: true, result, live: false };
  } catch (err) {
    return mapSyncError(err);
  }
}

export async function startQboConnect(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const { tenantId, role } = await tenantAndRole();
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can connect QuickBooks.' };
  }

  const env = qboEnv();
  const state = randomBytes(16).toString('hex');
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.QBO_REDIRECT_URI.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return {
    ok: true,
    url: buildAuthorizeUrl({
      clientId: env.QBO_CLIENT_ID,
      redirectUri: env.QBO_REDIRECT_URI,
      state,
    }),
  };
}

export async function runQboLiveSync(): Promise<QboSyncOutcome> {
  const { tenantId } = await tenantAndRole();
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  const admin = createSupabaseAdmin();
  try {
    const handle = await createQboAdapterForTenant(admin, tenantId, Date.now());
    if (!handle) return { ok: false, error: 'QuickBooks is not connected yet.' };

    const result = await summarizeQboPull(handle.adapter);
    await markConnectionSynced(admin, handle.connectionId, new Date().toISOString());
    revalidatePath('/integrations/quickbooks');
    return { ok: true, result, live: true };
  } catch (err) {
    return mapSyncError(err);
  }
}

export async function disconnectQbo(): Promise<{ ok: boolean; error?: string }> {
  const { tenantId, role } = await tenantAndRole();
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can disconnect QuickBooks.' };
  }

  const admin = createSupabaseAdmin();
  try {
    const conn = await loadQboConnection(admin, tenantId);
    if (conn) {
      const env = qboEnv();
      // Best-effort revoke; a failed revoke shouldn't block the local disconnect.
      try {
        await revokeToken(fetchTokenHttp, {
          clientId: env.QBO_CLIENT_ID,
          clientSecret: env.QBO_CLIENT_SECRET,
          token: conn.credentials.refreshToken,
        });
      } catch {
        // ignore — we still deactivate locally
      }
    }
    await deactivateQboConnection(admin, tenantId);
    revalidatePath('/integrations/quickbooks');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not disconnect. Please try again.' };
  }
}
