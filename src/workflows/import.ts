/**
 * CSV import — durable orchestration (Block 5, Wave 5.2-durable).
 *
 * Large imports run here instead of inline so they survive a crash and resume.
 * Per the directive boundary the Foundation smoke test pins down: the
 * `"use workflow"` orchestrator only sequences; ALL I/O (parse, DB writes,
 * progress) lives in the `"use step"` unit, which runs with full Node access and
 * whose result is persisted for deterministic replay.
 *
 * The step is idempotent (idempotent upserts + cursor-skip in `runImportDurable`),
 * so a retry after `process.exit(0)` converges to the same final state — the
 * FEATURES.md durability criterion — rather than double-writing.
 *
 * Authorization happened at the Server Action gate before `start()`; the step
 * writes via the service-role admin client with an explicit tenant_id.
 */

import type { ImportSummary } from '@/lib/import/commit';
import { type RunDurableParams, runImportDurable } from '@/lib/import/durable-commit';

async function importStep(params: RunDurableParams): Promise<ImportSummary> {
  'use step';

  // Log entry/exit so a hung run is debuggable via the dev-server logs /
  // `npx workflow inspect runs` (the smoke-test convention).
  console.log(`[import] step enter kind=${params.kind} syncRun=${params.syncRunId}`);
  const summary = await runImportDurable(params);
  console.log(
    `[import] step exit imported=${summary.imported} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return summary;
}

export async function importWorkflow(params: RunDurableParams): Promise<ImportSummary> {
  'use workflow';
  return await importStep(params);
}
