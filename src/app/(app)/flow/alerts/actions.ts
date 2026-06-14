'use server';

import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';
import { createSupabaseServer } from '@/lib/supabase/server';
import { alertGenerationWorkflow } from '@/workflows/alerts';

/**
 * Alert queue actions (in-app alerts engine). Acknowledge / dismiss are member
 * writes through the RLS client (the `alerts_update` policy fences them to the
 * tenant; the audit trigger logs every transition). Recompute starts the
 * durable generation workflow for an on-demand sweep.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

async function setStatus(
  alertId: string,
  status: 'acknowledged' | 'dismissed',
): Promise<ActionResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.tenant_id) return { ok: false, error: 'Your session expired. Sign in again.' };

  // RLS fences this to the caller's tenant + only open/acknowledged rows can move.
  const { error } = await supabase
    .from('alerts')
    .update({ status })
    .eq('id', alertId)
    .in('status', ['open', 'acknowledged']);
  if (error) return { ok: false, error: 'Could not update the alert. Try again.' };

  revalidatePath('/flow/alerts');
  return { ok: true };
}

export async function acknowledgeAlert(alertId: string): Promise<ActionResult> {
  return setStatus(alertId, 'acknowledged');
}

export async function dismissAlert(alertId: string): Promise<ActionResult> {
  return setStatus(alertId, 'dismissed');
}

export async function recomputeAlerts(): Promise<ActionResult> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  if (!tenantId) return { ok: false, error: 'Your session expired. Sign in again.' };

  try {
    await start(alertGenerationWorkflow, [{ tenantId, nowMs: Date.now() }]);
  } catch {
    return { ok: false, error: 'Could not start the alert sweep. Try again.' };
  }
  // The sweep runs durably; give it a beat then the queue revalidates on view.
  revalidatePath('/flow/alerts');
  return { ok: true };
}
