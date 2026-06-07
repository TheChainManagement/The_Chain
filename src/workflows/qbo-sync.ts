/**
 * QBO initial sync — durable orchestration (Block 6, Wave 6.2b).
 *
 * The first full pull of a connected QuickBooks company runs here instead of
 * inline so it survives a crash and resumes. Per the directive boundary the
 * Foundation smoke test pins down, the `"use workflow"` orchestrator only
 * sequences; ALL I/O (token refresh, QBO API pulls, DB writes, progress) lives
 * in the `"use step"` unit, which runs with full Node access and whose result is
 * persisted for deterministic replay.
 *
 * The step is idempotent (idempotent upserts + per-phase cursor in
 * `runQboInitialSync`), so a retry after a crash converges to the same final
 * state — re-pulling only the phases that hadn't completed — rather than
 * double-writing.
 *
 * Authorization happened at the Server Action gate before `start()`; the step
 * writes via the service-role admin client with an explicit tenant_id.
 */

import { type QboSyncCounts, type RunQboSyncParams, runQboInitialSync } from '@/lib/qbo/sync-core';

async function qboInitialSyncStep(params: RunQboSyncParams): Promise<QboSyncCounts> {
  'use step';

  // Log entry/exit so a hung run is debuggable via the dev-server logs /
  // `npx workflow inspect runs` (the smoke-test convention).
  console.log(`[qbo-sync] step enter tenant=${params.tenantId} syncRun=${params.syncRunId}`);
  const counts = await runQboInitialSync(params);
  console.log(
    `[qbo-sync] step exit catalog=${counts.catalog} suppliers=${counts.suppliers} receipts=${counts.receipts} sales=${counts.sales} errors=${counts.errors}`,
  );
  return counts;
}

export async function qboInitialSyncWorkflow(params: RunQboSyncParams): Promise<QboSyncCounts> {
  'use workflow';
  return await qboInitialSyncStep(params);
}
