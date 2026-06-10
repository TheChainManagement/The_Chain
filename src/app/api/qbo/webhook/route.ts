import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import {
  INTUIT_SIGNATURE_HEADER,
  parseEventRealmIds,
  verifyIntuitSignature,
} from '@/lib/qbo/webhook';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { qboIncrementalSyncWorkflow } from '@/workflows/qbo-incremental';

/**
 * Intuit QBO webhook (Block 6, Wave 6.3-D). Intuit POSTs a change notification
 * here whenever tracked entities change in a connected company, giving us
 * near-real-time sync between the 15-minute cron beats.
 *
 * Every callback is signature-verified BEFORE any processing (`FEATURES.md:289`):
 * the raw body is HMAC-SHA256'd with `QBO_WEBHOOK_VERIFIER_TOKEN` and compared
 * against the `intuit-signature` header. An unset verifier token means the
 * endpoint refuses (401) rather than processing unauthenticated calls — the same
 * refuse-by-default trust model as the cron's `CRON_SECRET`.
 *
 * On a valid call we map each notification's `realmId` to its active connection
 * and fan out the SAME durable `qboIncrementalSyncWorkflow` the cron runs (the
 * delta + conflict policy is idempotent). We ack 200 fast so Intuit doesn't retry;
 * the heavy lifting is the durable workflow, not this handler. A connection with a
 * sync already running is skipped so a multi-entity burst can't pile up runs.
 *
 * NOTE (contract deviation, mirrors the vercel.json/vercel.ts call): FEATURES.md
 * frames this as Workflow DevKit `createWebhook()` at `/.well-known/...`. Intuit
 * posts to a fixed URL with its own `intuit-signature` HMAC scheme, which the
 * DevKit per-token webhook trigger doesn't model — so this is an Intuit-native
 * route handler, consistent with the cron. Tracked in `_reviews/_tickets.md`.
 */
export async function POST(request: Request): Promise<Response> {
  const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
  const rawBody = await request.text();
  const signature = request.headers.get(INTUIT_SIGNATURE_HEADER);

  if (!verifierToken || !verifyIntuitSignature(rawBody, signature, verifierToken)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const realmIds = parseEventRealmIds(payload);
  if (realmIds.length === 0) return NextResponse.json({ ok: true, started: 0 });

  const admin = createSupabaseAdmin();
  const { data: conns } = await admin
    .from('source_connections')
    .select('id, tenant_id')
    .eq('source', 'qbo')
    .eq('status', 'active')
    .in('external_account_id', realmIds)
    .returns<{ id: string; tenant_id: string }[]>();

  let started = 0;
  for (const c of conns ?? []) {
    // Coalesce: if a sync is already running for this connection, the in-flight
    // delta will pick up the change (or the next cron will). Don't pile on.
    const { count: inFlight } = await admin
      .from('sync_runs')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', c.id)
      .eq('status', 'running');
    if (inFlight && inFlight > 0) continue;

    const trackingKey = randomBytes(16).toString('hex');
    const { data: run } = await admin
      .from('sync_runs')
      .insert({
        tenant_id: c.tenant_id,
        connection_id: c.id,
        workflow_run_id: trackingKey,
        status: 'running',
        started_at: new Date().toISOString(),
        cursor: { kind: 'incremental', done: false, trigger: 'webhook' },
      })
      .select('id')
      .single<{ id: string }>();
    if (!run) continue;

    try {
      await start(qboIncrementalSyncWorkflow, [
        { tenantId: c.tenant_id, connectionId: c.id, syncRunId: run.id },
      ]);
      started++;
    } catch (err) {
      await admin
        .from('sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_log: [err instanceof Error ? err.message : 'workflow failed to start'],
        })
        .eq('id', run.id);
    }
  }

  console.log(
    `[qbo-webhook] realms=${realmIds.length} matched=${conns?.length ?? 0} started=${started}`,
  );
  return NextResponse.json({ ok: true, matched: conns?.length ?? 0, started });
}
