/**
 * Purchase-order lifecycle — durable orchestration (Block 11b).
 *
 * Approval itself is a fast, user-facing transaction (it runs synchronously in
 * the Server Action so the operator sees `sent` vs `exported` immediately). What
 * is NOT fast is the wait for the goods to arrive — that can be days or months.
 * This workflow owns that wait durably: it parks on a deterministic receipt hook
 * and survives a crash, a redeploy, and a half-year gap between approve and
 * receive. The receive Server Action resumes it via `resumeHook(token, …)`.
 *
 * Per the directive boundary the Foundation smoke test pins down, the
 * `"use workflow"` orchestrator only sequences; the post-receipt finalize work
 * lives in a `"use step"` unit with full Node access whose result is persisted
 * for replay. The run waits for ONE completion signal: the receive action fires
 * the hook only when the order is fully in (partial receipts write stock
 * synchronously but don't need to wake the durable run), so a single `await`
 * models the lifecycle cleanly.
 */

import { createHook } from 'workflow';
import { finalizeReceivedPurchaseOrder } from '@/lib/purchase-orders/finalize';
import { poReceiptHookToken } from '@/lib/purchase-orders/lifecycle-token';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

interface LifecycleParams {
  tenantId: string;
  poId: string;
}

interface ReceiptEvent {
  status: 'received';
  actualDeliveryAt: string;
}

async function finalizeStep(params: LifecycleParams): Promise<string | null> {
  'use step';

  console.log(`[po-lifecycle] finalize enter tenant=${params.tenantId} po=${params.poId}`);
  const { status } = await finalizeReceivedPurchaseOrder(
    createSupabaseAdmin(),
    params.tenantId,
    params.poId,
  );
  console.log(`[po-lifecycle] finalize exit po=${params.poId} status=${status}`);
  return status;
}

export async function purchaseOrderLifecycleWorkflow(
  params: LifecycleParams,
): Promise<{ poId: string; finalStatus: string }> {
  'use workflow';

  // Suspend until the order is fully received. The run survives a crash, a
  // redeploy, and a months-long gap between approve and receive — the receive
  // Server Action resumes this deterministic token when the goods land.
  const hook = createHook<ReceiptEvent>({ token: poReceiptHookToken(params.poId) });
  await hook;

  await finalizeStep(params);
  return { poId: params.poId, finalStatus: 'received' };
}
