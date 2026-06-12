import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { forecastTenantBatchWorkflow } from '@/workflows/forecast-batch';

/**
 * Nightly forecast batch cron (Block 8, Wave 2b). Declared in `vercel.json`
 * (`15 7 * * *` — 7:15 UTC, before the US business day). Fans out one durable
 * `forecastTenantBatchWorkflow` per tenant that has an active catalog.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the env
 * var is set. We require it — an unset secret refuses to run rather than sit
 * open. Same trust model as the QBO incremental cron.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdmin();

  // Tenants with at least one active SKU. PostgREST can't select-distinct, so
  // page product tenant_ids and dedupe — tiny compared to the batch itself.
  const tenantIds = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin
      .from('products')
      .select('tenant_id')
      .eq('status', 'active')
      .order('tenant_id')
      .range(from, from + PAGE - 1)
      .returns<{ tenant_id: string }[]>();
    if (!data || data.length === 0) break;
    for (const r of data) tenantIds.add(r.tenant_id);
    if (data.length < PAGE) break;
  }

  let started = 0;
  for (const tenantId of tenantIds) {
    const trackingKey = randomBytes(16).toString('hex');
    const { data: run } = await admin
      .from('sync_runs')
      .insert({
        tenant_id: tenantId,
        connection_id: null,
        workflow_run_id: trackingKey,
        status: 'running',
        started_at: new Date().toISOString(),
        cursor: { kind: 'forecast_batch', done: false, processed: 0, total: 0 },
      })
      .select('id')
      .single<{ id: string }>();
    if (!run) continue;

    try {
      await start(forecastTenantBatchWorkflow, [{ tenantId, syncRunId: run.id }]);
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

  console.log(`[forecast-cron] tenants=${tenantIds.size} started=${started}`);
  return NextResponse.json({ ok: true, tenants: tenantIds.size, started });
}
