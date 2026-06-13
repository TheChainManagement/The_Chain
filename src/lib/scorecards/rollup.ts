/**
 * Supplier scorecard rollup (Block 10) — server-only.
 *
 * Refreshes `supplier_scorecards` for one supplier (all four windows) from its
 * `supplier_performance` history joined to the PO order date (for realized lead
 * time). `supplier_scorecards` is system-write (RLS select-only), so the rollup
 * runs through the service-role admin client — called after a receipt and by
 * the daily cron (the rolling windows shift even with no new receipts).
 *
 * Upserts on the (tenant, supplier, window_kind) PK; the Foundation audit
 * triggers do not cover scorecards (a derived rollup, not an operator edit),
 * which matches the audit matrix.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  leadTimeDays,
  type PerformanceRow,
  rollupWindow,
  SCORECARD_WINDOWS,
  windowRows,
} from '@/lib/scorecards/performance';

interface PerfJoinRow {
  on_time: boolean | null;
  in_full: boolean | null;
  on_time_in_full: boolean | null;
  actual_delivery_at: string | null;
  recorded_at: string;
  purchase_orders: { created_at: string } | null;
}

export async function rollupSupplierScorecards(
  admin: SupabaseClient,
  tenantId: string,
  supplierId: string,
  nowMs: number = Date.now(),
): Promise<number> {
  const { data: perf, error: readError } = await admin
    .from('supplier_performance')
    .select(
      'on_time, in_full, on_time_in_full, actual_delivery_at, recorded_at, purchase_orders ( created_at )',
    )
    .eq('tenant_id', tenantId)
    .eq('supplier_id', supplierId)
    .order('recorded_at', { ascending: false })
    .returns<PerfJoinRow[]>();
  // Fail hard: a swallowed read would derive empty/null scorecards from a real
  // history and silently zero a supplier's OTIF.
  if (readError) throw new Error(`could not read supplier performance: ${readError.message}`);

  const rows: PerformanceRow[] = (perf ?? []).map((p) => ({
    onTime: p.on_time,
    inFull: p.in_full,
    otif: p.on_time_in_full,
    deliveryAt: p.actual_delivery_at,
    recordedAt: p.recorded_at,
    leadTimeDays: leadTimeDays(p.purchase_orders?.created_at ?? null, p.actual_delivery_at),
  }));

  const computedAt = new Date(nowMs).toISOString();
  const cards = SCORECARD_WINDOWS.map(({ kind, days }) => {
    const stats = rollupWindow(windowRows(rows, days, nowMs));
    return {
      tenant_id: tenantId,
      supplier_id: supplierId,
      window_kind: kind,
      otif_pct: stats.otifPct,
      on_time_pct: stats.onTimePct,
      in_full_pct: stats.inFullPct,
      lead_time_avg_days: stats.leadTimeAvgDays,
      lead_time_stddev_days: stats.leadTimeStddevDays,
      sample_size: stats.sampleSize,
      computed_at: computedAt,
    };
  });

  const { error } = await admin
    .from('supplier_scorecards')
    .upsert(cards, { onConflict: 'tenant_id,supplier_id,window_kind' });
  if (error) throw new Error(`could not refresh supplier scorecards: ${error.message}`);

  return cards.find((c) => c.window_kind === 'all_time')?.sample_size ?? 0;
}
