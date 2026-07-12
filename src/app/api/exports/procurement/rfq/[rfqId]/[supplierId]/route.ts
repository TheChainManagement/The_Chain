import { NextResponse } from 'next/server';
import { getRfqDetail } from '@/lib/procurement/queries';
import { rfqToVendorCsv } from '@/lib/procurement/transform';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Per-vendor RFQ CSV (W2-3 slice 2, the export-for-manual-send decision).
 * One file per vendor: a readable header block, then the line table with
 * blank "your unit price" / "your lead time" columns the vendor fills in.
 * RLS-scoped: the server client only reads the caller's tenant.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ rfqId: string; supplierId: string }> },
): Promise<NextResponse> {
  const { rfqId, supplierId } = await params;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const rfq = await getRfqDetail(supabase, rfqId);
  if (!rfq) {
    return new NextResponse('Not found', { status: 404 });
  }
  const vendor = rfq.vendors.find((v) => v.supplierId === supplierId);
  if (!vendor) {
    return new NextResponse('Not found', { status: 404 });
  }

  const csv = rfqToVendorCsv(
    {
      title: rfq.title,
      vendorName: vendor.supplierName,
      locationName: rfq.locationName,
      respondBy: rfq.respondBy,
    },
    rfq.lines.map((l) => ({
      lineNo: l.lineNo,
      sku: l.sku,
      productName: l.productName,
      qty: l.qty,
      stockUom: l.stockUom,
      note: l.note,
    })),
  );

  const slug = vendor.supplierName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rfq-${slug}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
