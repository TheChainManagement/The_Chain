/**
 * Post-receipt finalization (Block 11b) — server-only. Runs as the terminal
 * step of `purchaseOrderLifecycleWorkflow` once the order is fully received.
 *
 * Today it confirms the order actually reached a terminal status (a cheap
 * integrity check: the hook fired, so the receive RPC should have advanced the
 * PO — a mismatch is an anomaly worth logging, not a crash). It is also the
 * documented seam where Block 12 will generate the "Why this receipt landed the
 * way it did" Claude insight, so the durable run is wired for that work now
 * rather than refactored for it later.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function finalizeReceivedPurchaseOrder(
  admin: SupabaseClient,
  tenantId: string,
  poId: string,
): Promise<{ status: string | null }> {
  const { data } = await admin
    .from('purchase_orders')
    .select('status')
    .eq('tenant_id', tenantId)
    .eq('id', poId)
    .maybeSingle<{ status: string }>();

  const status = data?.status ?? null;
  if (status !== 'received') {
    console.warn(
      `[po-lifecycle] finalize saw non-terminal status="${status}" for po=${poId} — ` +
        'receipt hook fired without the PO advancing to received.',
    );
  }
  // Block 12 insight generation hook attaches here.
  return { status };
}
