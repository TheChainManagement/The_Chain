/**
 * Alert generation — durable orchestration (in-app alerts engine).
 *
 * Runs after the forecast batch and on demand. Per the directive boundary the
 * Foundation smoke test pins down, the `"use workflow"` orchestrator only
 * sequences; the I/O (reading risk surfaces, the dedupe upserts, the auto-close
 * sweep) lives in the `"use step"` unit with full Node access, whose result is
 * persisted for replay. Generation is idempotent (the dedupe contract holds
 * unchanged conditions), so a retry after a crash converges.
 */

import { type GenerateAlertsResult, runAlertGeneration } from '@/lib/alerts/generate';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

interface AlertParams {
  tenantId: string;
  nowMs: number;
}

async function generateAlertsStep(params: AlertParams): Promise<GenerateAlertsResult> {
  'use step';

  console.log(`[alerts] generate enter tenant=${params.tenantId}`);
  const result = await runAlertGeneration(createSupabaseAdmin(), params.tenantId, params.nowMs);
  console.log(
    `[alerts] generate exit fired=${result.fired} created=${result.created} ` +
      `escalated=${result.escalated} held=${result.held} closed=${result.closed}`,
  );
  return result;
}

export async function alertGenerationWorkflow(params: AlertParams): Promise<GenerateAlertsResult> {
  'use workflow';
  return await generateAlertsStep(params);
}
