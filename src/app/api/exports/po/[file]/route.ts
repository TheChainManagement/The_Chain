import { type NextRequest, NextResponse } from 'next/server';
import { purchaseOrderToCsv } from '@/lib/purchase-orders/csv';
import { getPurchaseOrder } from '@/lib/purchase-orders/queries';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * PO CSV export (Block 11b). `/api/exports/po/<poId>.csv`. RLS-scoped: the
 * server client only resolves a PO the caller's tenant owns, so a foreign id
 * 404s rather than leaking. The filename rides the operator-facing reference.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await params;
  const poId = file.replace(/\.csv$/i, '');

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const po = await getPurchaseOrder(supabase, poId);
  if (!po) return new NextResponse('Not found', { status: 404 });

  const csv = purchaseOrderToCsv(po);
  // The reference can carry spaces ("QBO #301"); slugify for a clean filename.
  const slug =
    po.reference.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || `po-${po.id.slice(0, 8)}`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
