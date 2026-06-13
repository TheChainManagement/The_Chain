/**
 * Convert reorder recommendations → a purchase order (Block 11) — server-only.
 *
 * Promotes one or many OPEN recommendations to a single draft PO (FEATURES
 * step 3: multi-line if same supplier). The contract:
 *
 *  - All recommendations must share the SAME supplier (a PO has one vendor) and
 *    the SAME location. Mixed sets are rejected — the caller groups first.
 *  - Each recommendation becomes one PO line; recommended_qty → ordered_qty,
 *    unit_cost from the primary supplier link, the recommendation id linked.
 *  - The recommendations flip to `status='converted'` atomically with the PO
 *    creation so a recommendation can never be double-converted.
 *  - The PO lands `status='draft'`, `recommended_by='system'`; approving it
 *    (11b) writes back to QBO + advances the lifecycle.
 *
 * The whole thing runs in the `convert_recommendations_to_po` RPC under row
 * locks so a concurrent double-submit can't create two POs from one set.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConvertResult =
  | { ok: true; poId: string; lineCount: number }
  | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  no_recommendations: 'Select at least one open recommendation to convert.',
  not_open: 'One of those recommendations is no longer open.',
  mixed_supplier:
    'Those recommendations are from different suppliers — convert one supplier at a time.',
  mixed_location: 'Those recommendations are for different locations.',
  no_supplier: 'Those recommendations have no supplier set — assign one on the SKU first.',
};

export async function convertRecommendationsToPo(
  admin: SupabaseClient,
  params: { tenantId: string; recommendationIds: string[] },
): Promise<ConvertResult> {
  if (params.recommendationIds.length === 0) {
    return { ok: false, error: RPC_ERRORS.no_recommendations ?? 'Select at least one.' };
  }

  const { data, error } = await admin.rpc('convert_recommendations_to_po', {
    p_tenant: params.tenantId,
    p_recommendation_ids: params.recommendationIds,
  });

  if (error) {
    const code = (error.message.match(
      /\b(no_recommendations|not_open|mixed_supplier|mixed_location|no_supplier)\b/,
    ) ?? [])[1];
    const mapped = code ? RPC_ERRORS[code] : undefined;
    return { ok: false, error: mapped ?? 'Could not create the purchase order.' };
  }
  const row = (data as { out_po_id: string; out_line_count: number }[])?.[0];
  if (!row) return { ok: false, error: 'Could not create the purchase order.' };

  return { ok: true, poId: row.out_po_id, lineCount: row.out_line_count };
}
