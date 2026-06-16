'use server';

import { revalidatePath } from 'next/cache';
import { acknowledgeAlert } from '@/app/(app)/flow/alerts/actions';

/**
 * Today dashboard actions (Block 15). "Acknowledging today's recommendation" is
 * the heartbeat-stop interaction: the operator marks the most-pressing alert as
 * seen. It reuses the audited, RLS-fenced `acknowledgeAlert` (the alert update
 * is logged by the trigger) and additionally revalidates `/today` so the chain
 * settles on next view.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

export async function acknowledgeTopRecommendation(alertId: string): Promise<ActionResult> {
  const result = await acknowledgeAlert(alertId);
  if (result.ok) revalidatePath('/today');
  return result;
}
