'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { start } from 'workflow/api';
import { qboEnv } from '@/lib/env';
import { QboClient, QboSourceAdapter } from '@/lib/qbo';
import { deactivateQboConnection, loadQboConnection } from '@/lib/qbo/connection';
import { FixtureTransport } from '@/lib/qbo/fixtures';
import { buildAuthorizeUrl, fetchTokenHttp, revokeToken } from '@/lib/qbo/oauth';
import { type QboPullSummary, type QboSyncOutcome, summarizeQboPull } from '@/lib/qbo/summary';
import { FatalError, RetryableError } from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServer } from '@/lib/supabase/server';
import { qboInitialSyncWorkflow } from '@/workflows/qbo-sync';

/**
 * QBO connect + sync actions (Block 6 Wave 6.2).
 *
 * - `runQboSandboxSync` — read-only preview against fixtures (no creds, Wave 6.1).
 * - `startQboConnect` — owner/manager kicks the OAuth flow (CSRF state cookie).
 * - `runQboInitialSync` — owner/manager kicks the durable initial sync; the QBO
 *   adapter's pull is written INTO the catalog (products/suppliers/movements) by
 *   `qboInitialSyncWorkflow`, crash-safe. Returns a tracking key the client polls
 *   via `getQboSyncProgress` while the chain forms link by link (Wave 6.2b).
 * - `disconnectQbo` — revoke + deactivate; tenant data is left intact.
 *
 * The error catch maps the adapter taxonomy so the UI can tell rate-limit from
 * auth (an expired refresh token) from a generic fault.
 */

const STATE_COOKIE = 'qbo_oauth_state';
const PRIVILEGED = new Set(['owner', 'manager']);

const ZERO_COUNTS: QboPullSummary = {
  catalog: 0,
  suppliers: 0,
  ordered: 0,
  inTransit: 0,
  receipts: 0,
  sales: 0,
  errors: 0,
  skipped: 0,
};

export type QboSyncStart = { ok: true; trackingKey: string } | { ok: false; error: string };

export type QboSyncProgress =
  | { status: 'running'; phase: string; processed: number; total: number; counts: QboPullSummary }
  | { status: 'completed'; counts: QboPullSummary }
  | { status: 'failed'; error: string }
  | { status: 'unknown' };

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

/**
 * Kick the durable initial sync. Pre-creates the sync_run (so the poller finds it
 * with no race), then starts `qboInitialSyncWorkflow`, which writes the pulled QBO
 * data into the catalog and survives a crash. Returns the tracking key to poll.
 */
export async function runQboInitialSync(): Promise<QboSyncStart> {
  const { tenantId, role } = await tenantAndRole();
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };
  if (!role || !PRIVILEGED.has(role)) {
    return { ok: false, error: 'Only an owner or manager can sync QuickBooks.' };
  }

  const admin = createSupabaseAdmin();
  try {
    const conn = await loadQboConnection(admin, tenantId);
    if (!conn) return { ok: false, error: 'QuickBooks is not connected yet.' };

    const trackingKey = randomBytes(16).toString('hex');
    const { data: runRow, error } = await admin
      .from('sync_runs')
      .insert({
        tenant_id: tenantId,
        connection_id: conn.connectionId,
        workflow_run_id: trackingKey,
        status: 'running',
        started_at: new Date().toISOString(),
        cursor: {
          ...ZERO_COUNTS,
          phase: 'product',
          processed: 0,
          total: 0,
          results: {},
          done: false,
        },
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !runRow) {
      return { ok: false, error: 'Could not start the sync. Please try again.' };
    }

    try {
      await start(qboInitialSyncWorkflow, [{ tenantId, syncRunId: runRow.id }]);
    } catch (err) {
      // Run row exists but the workflow never started — don't leave it stuck on
      // 'running' (the poller would spin to its cap). Mark it failed.
      await admin
        .from('sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_log: [err instanceof Error ? err.message : 'workflow failed to start'],
        })
        .eq('id', runRow.id);
      return { ok: false, error: 'Could not start the sync. Please try again.' };
    }

    return { ok: true, trackingKey };
  } catch {
    return { ok: false, error: 'Could not start the sync. Please try again.' };
  }
}

/**
 * Poll a durable sync by tracking key. Reads sync_runs through the RLS client
 * (tenant-scoped), so a caller only ever sees their own runs. On completion the
 * catalog + supplier surfaces are revalidated so the freshly written rows show.
 */
export async function getQboSyncProgress(trackingKey: string): Promise<QboSyncProgress> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from('sync_runs')
    .select('status, cursor')
    .eq('workflow_run_id', trackingKey)
    .maybeSingle<{ status: string; cursor: (QboPullSummary & SyncCursorMeta) | null }>();

  if (!data) return { status: 'unknown' };
  const c = data.cursor;
  const counts: QboPullSummary = c ? extractCounts(c) : ZERO_COUNTS;

  if (data.status === 'failed') {
    return { status: 'failed', error: 'The sync did not finish. Please try again.' };
  }
  if (data.status === 'completed') {
    revalidatePath('/inventory');
    revalidatePath('/suppliers');
    return { status: 'completed', counts };
  }
  return {
    status: 'running',
    phase: c?.phase ?? 'product',
    processed: c?.processed ?? 0,
    total: c?.total ?? 0,
    counts,
  };
}

interface SyncCursorMeta {
  phase?: string;
  processed?: number;
  total?: number;
  done?: boolean;
}

function extractCounts(c: QboPullSummary): QboPullSummary {
  return {
    catalog: c.catalog ?? 0,
    suppliers: c.suppliers ?? 0,
    ordered: c.ordered ?? 0,
    inTransit: c.inTransit ?? 0,
    receipts: c.receipts ?? 0,
    sales: c.sales ?? 0,
    errors: c.errors ?? 0,
    skipped: c.skipped ?? 0,
  };
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
