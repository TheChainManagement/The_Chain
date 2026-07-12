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
       rfq_lines!rfq_lines_rfq_id_fkey ( count ),
       rfq_vendors!rfq_vendors_rfq_id_fkey ( status )`,
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

export interface RfqQuoteRow {
  supplierId: string;
  lineNo: number;
  quotedUnitCost: number;
  purchaseUom: string | null;
  factor: number | null;
  leadTimeDays: number | null;
  moq: number | null;
  note: string | null;
}

export interface DraftedRequisitionRow {
  id: string;
  status: string;
  total: number | null;
  createdAt: string;
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
  quotes: RfqQuoteRow[];
  draftedRequisitions: DraftedRequisitionRow[];
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
  rfq_vendor_quotes: {
    supplier_id: string;
    line_no: number;
    quoted_unit_cost: number;
    quoted_purchase_uom: string | null;
    purchase_to_stock_factor: number | null;
    lead_time_days: number | null;
    moq: number | null;
    note: string | null;
  }[];
  requisitions: {
    id: string;
    status: string;
    total: number | null;
    created_at: string;
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
       rfq_lines!rfq_lines_rfq_id_fkey ( line_no, qty, note, products ( id, sku, name, unit_of_measure ) ),
       rfq_vendors!rfq_vendors_rfq_id_fkey ( supplier_id, status, sent_at, suppliers ( name ) ),
       rfq_vendor_quotes!rfq_vendor_quotes_rfq_id_fkey ( supplier_id, line_no, quoted_unit_cost, quoted_purchase_uom, purchase_to_stock_factor, lead_time_days, moq, note ),
       requisitions!requisitions_source_rfq_id_fkey ( id, status, total, created_at )`,
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
    quotes: data.rfq_vendor_quotes.map((q) => ({
      supplierId: q.supplier_id,
      lineNo: q.line_no,
      quotedUnitCost: Number(q.quoted_unit_cost),
      purchaseUom: q.quoted_purchase_uom,
      factor: q.purchase_to_stock_factor == null ? null : Number(q.purchase_to_stock_factor),
      leadTimeDays: q.lead_time_days,
      moq: q.moq,
      note: q.note,
    })),
    draftedRequisitions: data.requisitions
      .map((r) => ({
        id: r.id,
        status: r.status,
        total: r.total == null ? null : Number(r.total),
        createdAt: r.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export interface LinkDefault {
  productId: string;
  supplierId: string;
  purchaseUom: string | null;
  factor: number | null;
}

/**
 * Supplier-link conversion defaults for the quote entry form: when a vendor
 * already has a purchase UoM + factor on file for a product, the entry cell
 * pre-fills them (the quote still snapshots its own copy).
 */
export async function listLinkDefaults(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<LinkDefault[]> {
  if (productIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from('product_suppliers')
    .select('product_id, supplier_id, purchase_uom, purchase_to_stock_factor')
    .in('product_id', productIds);
  if (error) {
    throw new Error(`listLinkDefaults failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    productId: r.product_id as string,
    supplierId: r.supplier_id as string,
    purchaseUom: (r.purchase_uom as string | null) ?? null,
    factor: r.purchase_to_stock_factor == null ? null : Number(r.purchase_to_stock_factor),
  }));
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

// ============================================================
// Slice 4 — requisition reads
// ============================================================

import type { RequisitionStatus } from './transform';

export interface RequisitionListRow {
  id: string;
  status: RequisitionStatus;
  locationName: string;
  sourceRfqTitle: string | null;
  lineCount: number;
  vendorCount: number;
  total: number | null;
  createdAt: string;
}

interface RawRequisitionListRow {
  id: string;
  status: RequisitionStatus;
  total: number | null;
  created_at: string;
  locations: { name: string } | null;
  rfqs: { title: string | null } | null;
  requisition_lines: { supplier_id: string }[];
}

export async function listRequisitions(supabase: SupabaseClient): Promise<RequisitionListRow[]> {
  const { data, error } = await supabase
    .from('requisitions')
    .select(
      `id, status, total, created_at,
       locations ( name ),
       rfqs!requisitions_source_rfq_id_fkey ( title ),
       requisition_lines ( supplier_id )`,
    )
    .order('created_at', { ascending: false })
    .returns<RawRequisitionListRow[]>();
  if (error) {
    throw new Error(`listRequisitions failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    locationName: r.locations?.name ?? '—',
    sourceRfqTitle: r.rfqs?.title ?? null,
    lineCount: r.requisition_lines.length,
    vendorCount: new Set(r.requisition_lines.map((l) => l.supplier_id)).size,
    total: r.total == null ? null : Number(r.total),
    createdAt: r.created_at,
  }));
}

export interface RequisitionLineDetail {
  lineNo: number;
  productId: string;
  sku: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  qty: number;
  unitCost: number | null;
  purchaseUom: string | null;
  factor: number | null;
  /** The supplier link's CURRENT cost, for the update-link affordance (design §8). */
  linkUnitCost: number | null;
}

export interface ConvertedPoRow {
  id: string;
  supplierName: string;
  status: string;
  total: number | null;
}

export interface RequisitionDetail {
  id: string;
  status: RequisitionStatus;
  locationName: string;
  sourceRfqId: string | null;
  sourceRfqTitle: string | null;
  requestedByUserId: string | null;
  rejectionNote: string | null;
  total: number | null;
  createdAt: string;
  lines: RequisitionLineDetail[];
  purchaseOrders: ConvertedPoRow[];
}

interface RawRequisitionDetail {
  id: string;
  status: RequisitionStatus;
  source_rfq_id: string | null;
  requested_by_user_id: string | null;
  rejection_note: string | null;
  total: number | null;
  created_at: string;
  locations: { name: string } | null;
  rfqs: { title: string | null } | null;
  requisition_lines: {
    line_no: number;
    qty: number;
    unit_cost: number | null;
    purchase_uom: string | null;
    purchase_to_stock_factor: number | null;
    supplier_id: string;
    products: { id: string; sku: string; name: string } | null;
    suppliers: { name: string } | null;
  }[];
  purchase_orders: {
    id: string;
    status: string;
    total: number | null;
    suppliers: { name: string } | null;
  }[];
}

export async function getRequisitionDetail(
  supabase: SupabaseClient,
  requisitionId: string,
): Promise<RequisitionDetail | null> {
  const { data, error } = await supabase
    .from('requisitions')
    .select(
      `id, status, source_rfq_id, requested_by_user_id, rejection_note, total, created_at,
       locations ( name ),
       rfqs!requisitions_source_rfq_id_fkey ( title ),
       requisition_lines ( line_no, qty, unit_cost, purchase_uom, purchase_to_stock_factor, supplier_id,
         products ( id, sku, name ), suppliers ( name ) ),
       purchase_orders ( id, status, total, suppliers ( name ) )`,
    )
    .eq('id', requisitionId)
    .maybeSingle<RawRequisitionDetail>();
  if (error) {
    throw new Error(`getRequisitionDetail failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const lines: RequisitionLineDetail[] = data.requisition_lines
    .map((l) => ({
      lineNo: l.line_no,
      productId: l.products?.id ?? '',
      sku: l.products?.sku ?? '—',
      productName: l.products?.name ?? '—',
      supplierId: l.supplier_id,
      supplierName: l.suppliers?.name ?? '—',
      qty: Number(l.qty),
      unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
      purchaseUom: l.purchase_uom,
      factor: l.purchase_to_stock_factor == null ? null : Number(l.purchase_to_stock_factor),
      linkUnitCost: null,
    }))
    .sort((a, b) => a.lineNo - b.lineNo);

  // Current link costs for the update-link-price affordance (design §8).
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: links } = await supabase
      .from('product_suppliers')
      .select('product_id, supplier_id, unit_cost')
      .in('product_id', productIds);
    for (const line of lines) {
      const link = (links ?? []).find(
        (k) => k.product_id === line.productId && k.supplier_id === line.supplierId,
      );
      line.linkUnitCost = link?.unit_cost == null ? null : Number(link.unit_cost);
    }
  }

  return {
    id: data.id,
    status: data.status,
    locationName: data.locations?.name ?? '—',
    sourceRfqId: data.source_rfq_id,
    sourceRfqTitle: data.rfqs?.title ?? null,
    requestedByUserId: data.requested_by_user_id,
    rejectionNote: data.rejection_note,
    total: data.total == null ? null : Number(data.total),
    createdAt: data.created_at,
    lines,
    purchaseOrders: data.purchase_orders.map((po) => ({
      id: po.id,
      supplierName: po.suppliers?.name ?? '—',
      status: po.status,
      total: po.total == null ? null : Number(po.total),
    })),
  };
}
