import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { qboIncrementalSyncWorkflow } from '@/workflows/qbo-incremental';

/**
 * QBO incremental-sync cron (Block 6, Wave 6.3-B). Declared in `vercel.json`
 * (`*​/15 * * * *`). Fans out one durable `qboIncrementalSyncWorkflow` per active
 * QuickBooks connection, each a delta against that connection's watermark.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the env var
 * is set. We require it — an unset secret means the endpoint refuses to run rather
 * than sit open. Runs with the service-role admin client (no user session in a
 * cron), authorized by the secret; the same trust model as the workflow steps.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  const { data: conns } = await admin
    .from('source_connections')
    .select('id, tenant_id')
    .eq('source', 'qbo')
    .eq('status', 'active')
    .returns<{ id: string; tenant_id: string }[]>();

  let started = 0;
  for (const c of conns ?? []) {
    const trackingKey = randomBytes(16).toString('hex');
    const { data: run } = await admin
      .from('sync_runs')
      .insert({
        tenant_id: c.tenant_id,
        connection_id: c.id,
        workflow_run_id: trackingKey,
        status: 'running',
        started_at: new Date().toISOString(),
        cursor: { kind: 'incremental', done: false },
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

  return NextResponse.json({ ok: true, connections: conns?.length ?? 0, started });
}
