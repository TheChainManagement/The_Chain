/** Reorder recommendations enter the shared requisition approval spine. */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConvertResult =
  | {
      ok: true;
      requisitionId: string;
      approvalStatus: 'approved' | 'submitted';
      reason: string;
      autoApproved: boolean;
      poId: string | null;
      lineCount: number;
    }
  | { ok: false; error: string };

const RPC_ERRORS: Record<string, string> = {
  no_recommendations: 'Select at least one open recommendation to convert.',
  not_open: 'One of those recommendations is no longer open.',
  mixed_supplier:
    'Those recommendations are from different suppliers — convert one supplier at a time.',
  mixed_location: 'Those recommendations are for different locations.',
  no_supplier: 'Those recommendations have no supplier set — assign one on the SKU first.',
  costed_lines_required: 'Every recommended item needs a supplier cost before submission.',
  reorder_conversion_forbidden: 'You do not have permission to submit those recommendations.',
};

export async function convertRecommendationsToPurchaseRequest(
  client: SupabaseClient,
  params: { tenantId: string; recommendationIds: string[] },
): Promise<ConvertResult> {
  if (params.recommendationIds.length === 0) {
    return { ok: false, error: RPC_ERRORS.no_recommendations ?? 'Select at least one.' };
  }

  const { data, error } = await client.rpc('convert_recommendations_to_requisition', {
    p_tenant: params.tenantId,
    p_recommendation_ids: params.recommendationIds,
  });

  if (error) {
    const code = (error.message.match(
      /\b(no_recommendations|not_open|mixed_supplier|mixed_location|no_supplier|costed_lines_required|reorder_conversion_forbidden)\b/,
    ) ?? [])[1];
    const mapped = code ? RPC_ERRORS[code] : undefined;
    return { ok: false, error: mapped ?? 'Could not submit the purchase request.' };
  }
  const row = (
    data as {
      out_requisition_id: string;
      out_approval_status: 'approved' | 'submitted';
      out_approval_reason: string;
      out_auto_approved: boolean;
      out_po_id: string | null;
      out_line_count: number;
    }[]
  )?.[0];
  if (!row) return { ok: false, error: 'Could not submit the purchase request.' };

  return {
    ok: true,
    requisitionId: row.out_requisition_id,
    approvalStatus: row.out_approval_status,
    reason: row.out_approval_reason,
    autoApproved: row.out_auto_approved,
    poId: row.out_po_id,
    lineCount: row.out_line_count,
  };
}
