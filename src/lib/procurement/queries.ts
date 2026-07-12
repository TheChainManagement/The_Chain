import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RfqStatus } from './transform';

/**
 * W2-3 procurement reads (slice 2: the RFQ bench). Server-only; tenant fencing
 * is RLS (`tenant_id = jwt_tenant_id()`), so these helpers never take a
 * tenant_id. Pure mapping stays in transform.ts.
 */

export interface RfqListRow {
  id: string;
  title: string;
  status: RfqStatus;
  locationName: string;
  lineCount: number;
  vendorCount: number;
  quotedVendorCount: number;
  respondBy: string | null;
  createdAt: string;
}

interface RawRfqListRow {
  id: string;
  title: string | null;
  status: RfqStatus;
  respond_by: string | null;
  created_at: string;
  locations: { name: string } | null;
  rfq_lines: { count: number }[];
  rfq_vendors: { status: string }[];
}

export async function listRfqs(supabase: SupabaseClient): Promise<RfqListRow[]> {
  const { data, error } = await supabase
    .from('rfqs')
    .select(
      `id, title, status, respond_by, created_at,
       locations ( name ),
       rfq_lines ( count ),
       rfq_vendors ( status )`,
    )
    .order('created_at', { ascending: false })
    .returns<RawRfqListRow[]>();
  if (error) {
    throw new Error(`listRfqs failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title ?? 'Untitled request',
    status: r.status,
    locationName: r.locations?.name ?? '—',
    lineCount: r.rfq_lines[0]?.count ?? 0,
    vendorCount: r.rfq_vendors.length,
    quotedVendorCount: r.rfq_vendors.filter((v) => v.status === 'quoted').length,
    respondBy: r.respond_by,
    createdAt: r.created_at,
  }));
}

export interface RfqLineRow {
  lineNo: number;
  productId: string;
  sku: string;
  productName: string;
  stockUom: string | null;
  qty: number;
  note: string | null;
}

export interface RfqVendorRow {
  supplierId: string;
  supplierName: string;
  status: 'pending' | 'quoted' | 'declined';
  sentAt: string | null;
}

export interface RfqDetail {
  id: string;
  title: string;
  note: string | null;
  status: RfqStatus;
  locationId: string;
  locationName: string;
  respondBy: string | null;
  sentAt: string | null;
  createdAt: string;
  lines: RfqLineRow[];
  vendors: RfqVendorRow[];
}

interface RawRfqDetail {
  id: string;
  title: string | null;
  note: string | null;
  status: RfqStatus;
  location_id: string;
  respond_by: string | null;
  sent_at: string | null;
  created_at: string;
  locations: { name: string } | null;
  rfq_lines: {
    line_no: number;
    qty: number;
    note: string | null;
    products: { id: string; sku: string; name: string; unit_of_measure: string | null } | null;
  }[];
  rfq_vendors: {
    supplier_id: string;
    status: 'pending' | 'quoted' | 'declined';
    sent_at: string | null;
    suppliers: { name: string } | null;
  }[];
}

export async function getRfqDetail(
  supabase: SupabaseClient,
  rfqId: string,
): Promise<RfqDetail | null> {
  const { data, error } = await supabase
    .from('rfqs')
    .select(
      `id, title, note, status, location_id, respond_by, sent_at, created_at,
       locations ( name ),
       rfq_lines ( line_no, qty, note, products ( id, sku, name, unit_of_measure ) ),
       rfq_vendors ( supplier_id, status, sent_at, suppliers ( name ) )`,
    )
    .eq('id', rfqId)
    .maybeSingle<RawRfqDetail>();
  if (error) {
    throw new Error(`getRfqDetail failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return {
    id: data.id,
    title: data.title ?? 'Untitled request',
    note: data.note,
    status: data.status,
    locationId: data.location_id,
    locationName: data.locations?.name ?? '—',
    respondBy: data.respond_by,
    sentAt: data.sent_at,
    createdAt: data.created_at,
    lines: data.rfq_lines
      .map((l) => ({
        lineNo: l.line_no,
        productId: l.products?.id ?? '',
        sku: l.products?.sku ?? '—',
        productName: l.products?.name ?? '—',
        stockUom: l.products?.unit_of_measure ?? null,
        qty: Number(l.qty),
        note: l.note,
      }))
      .sort((a, b) => a.lineNo - b.lineNo),
    vendors: data.rfq_vendors
      .map((v) => ({
        supplierId: v.supplier_id,
        supplierName: v.suppliers?.name ?? '—',
        status: v.status,
        sentAt: v.sent_at,
      }))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
  };
}

export interface SkuOption {
  id: string;
  sku: string;
  name: string;
}

/** Active-catalog options for the add-line datalist (count-sheet pattern). */
export async function listSkuOptions(supabase: SupabaseClient): Promise<SkuOption[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('status', 'active')
    .order('sku', { ascending: true })
    .limit(500);
  if (error) {
    throw new Error(`listSkuOptions failed: ${error.message}`);
  }
  return data ?? [];
}

export interface LocationOption {
  id: string;
  name: string;
}

export async function listLocationOptions(supabase: SupabaseClient): Promise<LocationOption[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`listLocationOptions failed: ${error.message}`);
  }
  return data ?? [];
}
