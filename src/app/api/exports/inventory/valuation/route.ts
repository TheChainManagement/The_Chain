import { NextResponse } from 'next/server';
import { listValuation, valuationToCsv } from '@/lib/inventory/valuation';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Inventory valuation CSV export (W2-2.5).
 * `/api/exports/inventory/valuation` → `inventory-valuation.csv`, one row per
 * SKU per location at moving-average cost. RLS-scoped: the server client only
 * reads the caller's tenant.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const rows = await listValuation(supabase);
  const csv = valuationToCsv(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="inventory-valuation.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
