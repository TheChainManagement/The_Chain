/**
 * Reorder policy context (Block 12) — the on-hand / DOS / reorder-point /
 * stockout-risk figures the "Why this reorder" insight narrates. NOT server-only:
 * the insight generator reads them via the admin client to build its facts, AND
 * the PO detail page renders them as a stat row via the RLS client, so every
 * number Claude states is verifiable on-screen (trust hierarchy). One reader =
 * the prose and the surface can never disagree.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReorderContext {
  onHand: number | null;
  daysOfSupply: number | null;
  reorderPoint: number | null;
  stockoutRiskPct: number | null;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Policy + level numbers for a (product, location). */
export async function loadPolicyNumbers(
  client: SupabaseClient,
  tenantId: string,
  productId: string,
  locationId: string,
): Promise<ReorderContext> {
  const [{ data: policy }, { data: level }] = await Promise.all([
    client
      .from('inventory_policy')
      .select('reorder_point, days_of_supply, stockout_risk_score')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .maybeSingle<{
        reorder_point: number | string | null;
        days_of_supply: number | string | null;
        stockout_risk_score: number | string | null;
      }>(),
    client
      .from('inventory_levels')
      .select('on_hand')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .maybeSingle<{ on_hand: number | string }>(),
  ]);
  return {
    onHand: level?.on_hand == null ? null : round1(Number(level.on_hand)),
    daysOfSupply: policy?.days_of_supply == null ? null : round1(Number(policy.days_of_supply)),
    reorderPoint: policy?.reorder_point == null ? null : Number(policy.reorder_point),
    stockoutRiskPct:
      policy?.stockout_risk_score == null
        ? null
        : Math.round(Number(policy.stockout_risk_score) * 100),
  };
}

/**
 * Resolve a PO's primary (lowest line_no) line, then its policy numbers — the
 * same line the reorder insight narrates. Returns null when the PO has no line.
 */
export async function loadReorderContext(
  client: SupabaseClient,
  tenantId: string,
  poId: string,
): Promise<ReorderContext | null> {
  const { data: po } = await client
    .from('purchase_orders')
    .select('location_id, purchase_order_lines ( product_id, line_no )')
    .eq('tenant_id', tenantId)
    .eq('id', poId)
    .maybeSingle<{
      location_id: string;
      purchase_order_lines: { product_id: string; line_no: number }[] | null;
    }>();
  const line = [...(po?.purchase_order_lines ?? [])].sort((a, b) => a.line_no - b.line_no)[0];
  if (!po || !line?.product_id) return null;
  return loadPolicyNumbers(client, tenantId, line.product_id, po.location_id);
}
