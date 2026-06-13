import { NextResponse } from 'next/server';
import { rollupSupplierScorecards } from '@/lib/scorecards/rollup';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Daily supplier-scorecard rollup cron (Block 10). Declared in `vercel.json`
 * (`30 7 * * *`). Re-rolls every supplier that has performance history — the
 * rolling windows (30/90/365d) shift each day even with no new receipt, so a
 * supplier's OTIF and empirical lead time stay current without a delivery.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the env
 * var is set; we require it. Service-role admin client (scorecards are
 * system-write), authorized by the secret.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createSupabaseAdmin();

  // Distinct (tenant, supplier) pairs with performance history. Paged to clear
  // the PostgREST 1000-row cap; deduped in memory (tiny vs the rollups).
  const pairs = new Map<string, { tenantId: string; supplierId: string }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('supplier_performance')
      .select('tenant_id, supplier_id')
      .order('tenant_id')
      .range(from, from + PAGE - 1)
      .returns<{ tenant_id: string; supplier_id: string }[]>();
    // Fail loud rather than report a false "0 suppliers · ok".
    if (error) {
      return NextResponse.json({ error: 'failed to read supplier performance' }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const r of data)
      pairs.set(`${r.tenant_id}:${r.supplier_id}`, {
        tenantId: r.tenant_id,
        supplierId: r.supplier_id,
      });
    if (data.length < PAGE) break;
  }

  let rolled = 0;
  for (const { tenantId, supplierId } of pairs.values()) {
    try {
      await rollupSupplierScorecards(admin, tenantId, supplierId);
      rolled++;
    } catch (err) {
      console.error(`[scorecards-cron] rollup failed ${tenantId}/${supplierId}:`, err);
    }
  }

  console.log(`[scorecards-cron] suppliers=${pairs.size} rolled=${rolled}`);
  return NextResponse.json({ ok: true, suppliers: pairs.size, rolled });
}
