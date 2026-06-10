/**
 * QBO incremental sync — durable orchestration (Block 6, Wave 6.3-B).
 *
 * The 15-minute delta (and the manual "Sync now") run here so they survive a
 * crash and resume. Same directive boundary as the initial sync: the
 * `"use workflow"` orchestrator only sequences; ALL I/O (token refresh, delta
 * pulls, conflict-policy writes, watermark advance) lives in the `"use step"`
 * unit. Idempotent — a retry re-pulls the same delta window and the conflict
 * policy + idempotent movement upserts converge.
 *
 * Authorization happened at the action / cron gate before `start()`; the step
 * writes via the service-role admin client with an explicit tenant_id.
 */

import {
  type IncrementalSummary,
  type RunIncrementalParams,
  runQboIncrementalSync,
} from '@/lib/qbo/incremental-core';

async function qboIncrementalStep(params: RunIncrementalParams): Promise<IncrementalSummary> {
  'use step';

  console.log(
    `[qbo-incremental] step enter tenant=${params.tenantId} conn=${params.connectionId} syncRun=${params.syncRunId}`,
  );
  const summary = await runQboIncrementalSync(params);
  console.log(
    `[qbo-incremental] step exit inserted=${summary.inserted} updated=${summary.updated} movements=${summary.movements} conflicts=${summary.conflicts} needsReview=${summary.needsReview} errors=${summary.errors}`,
  );
  return summary;
}

export async function qboIncrementalSyncWorkflow(
  params: RunIncrementalParams,
): Promise<IncrementalSummary> {
  'use workflow';
  return await qboIncrementalStep(params);
}
