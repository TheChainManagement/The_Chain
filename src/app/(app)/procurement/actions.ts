'use server';

import { revalidatePath } from 'next/cache';
import {
  canCancel,
  canClose,
  canEditDocument,
  canSend,
  mapRfqWriteError,
  PERMISSION_MESSAGE,
  RFQ_WRITER_ROLES,
  type RfqStatus,
  validateLineQty,
  validateRfqInput,
} from '@/lib/procurement/transform';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * RFQ mutations (W2-3 slice 2). All writes go through the RLS member client
 * (owner|manager|planner per the W2-3a policies) — these are documents, not
 * balances; nothing here may touch stock (design §1, probe-enforced). The
 * role check up front is the friendly-error layer; RLS is the real gate.
 */

export type RfqActionState = { ok: true; rfqId: string } | { ok: false; error: string } | null;

export type RfqEditState = { ok: true } | { ok: false; error: string } | null;

type Server = Awaited<ReturnType<typeof createSupabaseServer>>;

async function resolveActor(
  supabase: Server,
): Promise<{ tenantId: string; userId: string | null; role: string } | null> {
  const { data } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.tenant_id as string | undefined;
  const role = data?.claims?.tenant_role as string | undefined;
  const userId = (data?.claims?.sub as string | undefined) ?? null;
  if (!tenantId || !role || !RFQ_WRITER_ROLES.has(role)) {
    return null;
  }
  return { tenantId, userId, role };
}

async function loadRfqState(
  supabase: Server,
  rfqId: string,
): Promise<{ status: RfqStatus; lineCount: number; vendorCount: number } | null> {
  const { data } = await supabase
    .from('rfqs')
    .select(
      'status, rfq_lines!rfq_lines_rfq_id_fkey ( count ), rfq_vendors!rfq_vendors_rfq_id_fkey ( count )',
    )
    .eq('id', rfqId)
    .maybeSingle<{
      status: RfqStatus;
      rfq_lines: { count: number }[];
      rfq_vendors: { count: number }[];
    }>();
  if (!data) {
    return null;
  }
  return {
    status: data.status,
    lineCount: data.rfq_lines[0]?.count ?? 0,
    vendorCount: data.rfq_vendors[0]?.count ?? 0,
  };
}

export async function createRfq(
  _prev: RfqActionState,
  formData: FormData,
): Promise<RfqActionState> {
  const title = String(formData.get('title') ?? '').trim();
  const locationId = String(formData.get('location_id') ?? '').trim();
  const respondBy = String(formData.get('respond_by') ?? '').trim();

  const valid = validateRfqInput({ title, locationId });
  if (!valid.ok) {
    return valid;
  }

  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const { data, error } = await supabase
    .from('rfqs')
    .insert({
      tenant_id: actor.tenantId,
      location_id: locationId,
      title,
      respond_by: respondBy || null,
      created_by_user_id: actor.userId,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: mapRfqWriteError(error?.code, error?.message ?? '') };
  }

  revalidatePath('/procurement');
  return { ok: true, rfqId: data.id };
}

export async function addRfqLine(_prev: RfqEditState, formData: FormData): Promise<RfqEditState> {
  const rfqId = String(formData.get('rfq_id') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const qtyRaw = String(formData.get('qty') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!rfqId || !sku) {
    return { ok: false, error: 'Pick a SKU from the catalog.' };
  }
  const qty = validateLineQty(qtyRaw);
  if (!qty.ok) {
    return qty;
  }

  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const state = await loadRfqState(supabase, rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const editable = canEditDocument(state.status);
  if (!editable.ok) {
    return editable;
  }

  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('sku', sku)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>();
  if (!product) {
    return { ok: false, error: `No active SKU "${sku}" in the catalog.` };
  }

  const { error } = await supabase.from('rfq_lines').insert({
    tenant_id: actor.tenantId,
    rfq_id: rfqId,
    line_no: state.lineCount + 1,
    product_id: product.id,
    qty: qty.qty,
    note: note || null,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }

  revalidatePath(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

export async function removeRfqLine(input: {
  rfqId: string;
  lineNo: number;
}): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, input.rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const editable = canEditDocument(state.status);
  if (!editable.ok) {
    return editable;
  }

  const { error } = await supabase
    .from('rfq_lines')
    .delete()
    .eq('rfq_id', input.rfqId)
    .eq('line_no', input.lineNo);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  return { ok: true };
}

export async function addRfqVendor(input: {
  rfqId: string;
  supplierId: string;
}): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, input.rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const editable = canEditDocument(state.status);
  if (!editable.ok) {
    return editable;
  }

  const { error } = await supabase.from('rfq_vendors').insert({
    tenant_id: actor.tenantId,
    rfq_id: input.rfqId,
    supplier_id: input.supplierId,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  return { ok: true };
}

export async function removeRfqVendor(input: {
  rfqId: string;
  supplierId: string;
}): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, input.rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const editable = canEditDocument(state.status);
  if (!editable.ok) {
    return editable;
  }

  const { error } = await supabase
    .from('rfq_vendors')
    .delete()
    .eq('rfq_id', input.rfqId)
    .eq('supplier_id', input.supplierId);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  return { ok: true };
}

/**
 * Send = the export-for-manual-send decision (design §7.2): stamps the RFQ and
 * every vendor row sent; the per-vendor documents become the primary artifacts.
 * No email leaves the app.
 */
export async function sendRfq(input: { rfqId: string }): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, input.rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const sendable = canSend(state.status, state.lineCount, state.vendorCount);
  if (!sendable.ok) {
    return sendable;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('rfqs')
    .update({ status: 'sent', sent_at: now })
    .eq('id', input.rfqId)
    .eq('status', 'draft');
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  const { error: vendorError } = await supabase
    .from('rfq_vendors')
    .update({ sent_at: now })
    .eq('rfq_id', input.rfqId);
  if (vendorError) {
    return { ok: false, error: mapRfqWriteError(vendorError.code, vendorError.message) };
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  return { ok: true };
}

export async function closeRfq(input: { rfqId: string }): Promise<RfqEditState> {
  return settleRfq(input.rfqId, 'closed', canClose);
}

export async function cancelRfq(input: { rfqId: string }): Promise<RfqEditState> {
  return settleRfq(input.rfqId, 'canceled', canCancel);
}

async function settleRfq(
  rfqId: string,
  target: 'closed' | 'canceled',
  guard: (status: RfqStatus) => { ok: true } | { ok: false; error: string },
): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const allowed = guard(state.status);
  if (!allowed.ok) {
    return allowed;
  }

  const { error } = await supabase.from('rfqs').update({ status: target }).eq('id', rfqId);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidatePath('/procurement');
  revalidatePath(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

/**
 * "Request quotes" from the reorder queue (design §6): the selected
 * recommendation set (already fenced to one supplier + location by the queue)
 * becomes a draft RFQ — lines from the recommendations, the group's supplier
 * pre-filled as the first vendor. Recommendations stay OPEN: quoting precedes
 * ordering, and the operator converts them (or the requisition does) later.
 */
export async function createRfqFromRecommendations(input: {
  recommendationIds: string[];
}): Promise<RfqActionState> {
  if (input.recommendationIds.length === 0) {
    return { ok: false, error: 'Select recommendations to quote first.' };
  }

  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const { data: recs, error: recsError } = await supabase
    .from('reorder_recommendations')
    .select('id, product_id, location_id, supplier_id, recommended_qty, status')
    .in('id', input.recommendationIds);
  if (recsError || !recs || recs.length === 0) {
    return { ok: false, error: 'Those recommendations are no longer available.' };
  }
  if (recs.some((r) => r.status !== 'open')) {
    return { ok: false, error: 'Only open recommendations can be quoted.' };
  }
  const locations = new Set(recs.map((r) => r.location_id));
  if (locations.size !== 1) {
    return { ok: false, error: 'Quote one location at a time.' };
  }
  const suppliers = new Set(recs.map((r) => r.supplier_id).filter(Boolean));

  const { data: rfq, error: rfqError } = await supabase
    .from('rfqs')
    .insert({
      tenant_id: actor.tenantId,
      location_id: recs[0]?.location_id,
      title: `Reorder quotes ${new Date().toISOString().slice(0, 10)}`,
      created_by_user_id: actor.userId,
    })
    .select('id')
    .single<{ id: string }>();
  if (rfqError || !rfq) {
    return { ok: false, error: mapRfqWriteError(rfqError?.code, rfqError?.message ?? '') };
  }

  const lines = recs.map((r, i) => ({
    tenant_id: actor.tenantId,
    rfq_id: rfq.id,
    line_no: i + 1,
    product_id: r.product_id,
    qty: r.recommended_qty,
  }));
  const { error: linesError } = await supabase.from('rfq_lines').insert(lines);
  if (linesError) {
    return { ok: false, error: mapRfqWriteError(linesError.code, linesError.message) };
  }

  if (suppliers.size > 0) {
    const vendorRows = [...suppliers].map((supplierId) => ({
      tenant_id: actor.tenantId,
      rfq_id: rfq.id,
      supplier_id: supplierId,
    }));
    const { error: vendorsError } = await supabase.from('rfq_vendors').insert(vendorRows);
    if (vendorsError) {
      return { ok: false, error: mapRfqWriteError(vendorsError.code, vendorsError.message) };
    }
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/rfqs/${rfq.id}`);
  return { ok: true, rfqId: rfq.id };
}

// ============================================================
// Slice 3 — quote entry + award (design §7.3)
// ============================================================

import { type AwardPick, canEnterQuotes, validateQuoteInput } from '@/lib/procurement/transform';

/**
 * Upsert one vendor's quote for one line, entered by the operator from the
 * vendor's reply. Flips the vendor plate to 'quoted' and — when no vendor is
 * still pending — the RFQ itself to 'quoted' (design §5's auto-flip).
 */
export async function saveVendorQuote(
  _prev: RfqEditState,
  formData: FormData,
): Promise<RfqEditState> {
  const rfqId = String(formData.get('rfq_id') ?? '').trim();
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  const lineNo = Number(String(formData.get('line_no') ?? ''));
  if (!rfqId || !supplierId || !Number.isInteger(lineNo)) {
    return { ok: false, error: 'Missing quote reference.' };
  }
  const parsed = validateQuoteInput({
    cost: String(formData.get('cost') ?? ''),
    purchaseUom: String(formData.get('purchase_uom') ?? ''),
    factor: String(formData.get('factor') ?? ''),
    leadTimeDays: String(formData.get('lead_time_days') ?? ''),
    moq: String(formData.get('moq') ?? ''),
  });
  if (!parsed.ok) {
    return parsed;
  }
  const note = String(formData.get('note') ?? '').trim();

  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const open = canEnterQuotes(state.status);
  if (!open.ok) {
    return open;
  }

  const { error } = await supabase.from('rfq_vendor_quotes').upsert(
    {
      tenant_id: actor.tenantId,
      rfq_id: rfqId,
      supplier_id: supplierId,
      line_no: lineNo,
      quoted_unit_cost: parsed.quote.cost,
      quoted_purchase_uom: parsed.quote.purchaseUom,
      purchase_to_stock_factor: parsed.quote.factor,
      lead_time_days: parsed.quote.leadTimeDays,
      moq: parsed.quote.moq,
      note: note || null,
      entered_by_user_id: actor.userId,
      entered_at: new Date().toISOString(),
    },
    { onConflict: 'rfq_id,supplier_id,line_no' },
  );
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }

  const { error: vendorError } = await supabase
    .from('rfq_vendors')
    .update({ status: 'quoted', responded_at: new Date().toISOString() })
    .eq('rfq_id', rfqId)
    .eq('supplier_id', supplierId);
  if (vendorError) {
    return { ok: false, error: mapRfqWriteError(vendorError.code, vendorError.message) };
  }

  await autoFlipQuoted(supabase, rfqId);
  revalidatePath(`/procurement/rfqs/${rfqId}`);
  revalidatePath('/procurement');
  return { ok: true };
}

/** A vendor who answered "no bid": their column settles without a quote. */
export async function markVendorDeclined(input: {
  rfqId: string;
  supplierId: string;
}): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const state = await loadRfqState(supabase, input.rfqId);
  if (!state) {
    return { ok: false, error: 'That quote request no longer exists.' };
  }
  const open = canEnterQuotes(state.status);
  if (!open.ok) {
    return open;
  }

  const { error } = await supabase
    .from('rfq_vendors')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('rfq_id', input.rfqId)
    .eq('supplier_id', input.supplierId);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }

  await autoFlipQuoted(supabase, input.rfqId);
  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  revalidatePath('/procurement');
  return { ok: true };
}

async function autoFlipQuoted(supabase: Server, rfqId: string): Promise<void> {
  const { data } = await supabase.from('rfq_vendors').select('status').eq('rfq_id', rfqId);
  const vendors = data ?? [];
  if (vendors.length > 0 && vendors.every((v) => v.status !== 'pending')) {
    await supabase.from('rfqs').update({ status: 'quoted' }).eq('id', rfqId).eq('status', 'sent');
  }
}

export type AwardActionResult =
  | { ok: true; requisitionId: string; total: number }
  | { ok: false; error: string };

/**
 * Award the picked quotes into a DRAFT requisition (design §10 slice 3's exit).
 * Lines convert the RFQ's stock quantities into each winning vendor's purchase
 * unit and snapshot the quote's cost + UoM — the same purchase basis PO lines
 * use, so slice 4's convert-to-PO is a straight copy. ZERO balance writes:
 * this creates a document, nothing else.
 */
export async function awardQuotesToRequisition(input: {
  rfqId: string;
  picks: AwardPick[];
}): Promise<AwardActionResult> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const { data, error } = await supabase.rpc('award_rfq_quotes_to_requisition', {
    p_tenant: actor.tenantId,
    p_rfq: input.rfqId,
    p_picks: input.picks,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  const award = (data?.[0] ?? null) as {
    out_requisition_id: string;
    out_total: number | string;
  } | null;
  if (!award) {
    return { ok: false, error: 'The requisition could not be drafted.' };
  }

  revalidatePath(`/procurement/rfqs/${input.rfqId}`);
  revalidatePath('/procurement');
  return {
    ok: true,
    requisitionId: award.out_requisition_id,
    total: Number(award.out_total),
  };
}

// ============================================================
// Slice 4 — requisition lifecycle + convert (design §5, §7.1, §8)
// ============================================================

import {
  canCancelRequisition,
  canConvertRequisition,
  canDecideRequisition,
  canSubmitRequisition,
  type RequisitionStatus,
} from '@/lib/procurement/transform';

async function loadRequisition(
  supabase: Server,
  requisitionId: string,
): Promise<{ status: RequisitionStatus; requestedByUserId: string | null } | null> {
  const { data } = await supabase
    .from('requisitions')
    .select('status, requested_by_user_id')
    .eq('id', requisitionId)
    .maybeSingle<{ status: RequisitionStatus; requested_by_user_id: string | null }>();
  if (!data) {
    return null;
  }
  return { status: data.status, requestedByUserId: data.requested_by_user_id };
}

function revalidateRequisition(requisitionId: string): void {
  revalidatePath('/procurement');
  revalidatePath(`/procurement/requisitions/${requisitionId}`);
}

/** Draft (or rejected) → submitted. Any procurement writer may submit. */
export async function submitRequisition(input: { requisitionId: string }): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const req = await loadRequisition(supabase, input.requisitionId);
  if (!req) {
    return { ok: false, error: 'That requisition no longer exists.' };
  }
  const allowed = canSubmitRequisition(req.status);
  if (!allowed.ok) {
    return allowed;
  }

  const { error } = await supabase
    .from('requisitions')
    .update({ status: 'submitted', rejection_note: null })
    .eq('id', input.requisitionId);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidateRequisition(input.requisitionId);
  return { ok: true };
}

/**
 * Single-step approval (design §7.1, MG-locked): owner or manager, never the
 * requester deciding their own submission. Approve stamps the decision trail.
 */
export async function approveRequisition(input: { requisitionId: string }): Promise<RfqEditState> {
  return decideRequisition(input.requisitionId, 'approved', null);
}

export async function rejectRequisition(input: {
  requisitionId: string;
  note: string;
}): Promise<RfqEditState> {
  const note = input.note.trim();
  if (!note) {
    return { ok: false, error: 'Tell the requester why (a short note is required to reject).' };
  }
  return decideRequisition(input.requisitionId, 'rejected', note);
}

async function decideRequisition(
  requisitionId: string,
  decision: 'approved' | 'rejected',
  rejectionNote: string | null,
): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const req = await loadRequisition(supabase, requisitionId);
  if (!req) {
    return { ok: false, error: 'That requisition no longer exists.' };
  }
  const allowed = canDecideRequisition({
    status: req.status,
    role: actor.role,
    actorUserId: actor.userId,
    requestedByUserId: req.requestedByUserId,
  });
  if (!allowed.ok) {
    return allowed;
  }

  const { error } = await supabase.rpc('decide_requisition', {
    p_tenant: actor.tenantId,
    p_requisition: requisitionId,
    p_decision: decision,
    p_rejection_note: rejectionNote,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidateRequisition(requisitionId);
  return { ok: true };
}

export async function cancelRequisition(input: { requisitionId: string }): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const req = await loadRequisition(supabase, input.requisitionId);
  if (!req) {
    return { ok: false, error: 'That requisition no longer exists.' };
  }
  const allowed = canCancelRequisition(req.status);
  if (!allowed.ok) {
    return allowed;
  }

  const { error } = await supabase
    .from('requisitions')
    .update({ status: 'canceled' })
    .eq('id', input.requisitionId);
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  revalidateRequisition(input.requisitionId);
  return { ok: true };
}

export type ConvertRequisitionResult =
  | { ok: true; pos: { poId: string; supplierId: string; lineCount: number }[]; applied: boolean }
  | { ok: false; error: string };

/**
 * Approved → purchase orders via the W2-3d RPC (one PO per supplier,
 * purchase-UoM lines copied straight across, requisition stamped converted).
 * The RPC is idempotent; replay returns the existing POs. No balance writes.
 */
export async function convertRequisition(input: {
  requisitionId: string;
}): Promise<ConvertRequisitionResult> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }
  const req = await loadRequisition(supabase, input.requisitionId);
  if (!req) {
    return { ok: false, error: 'That requisition no longer exists.' };
  }
  const allowed = canConvertRequisition(req.status);
  if (!allowed.ok) {
    return allowed;
  }

  const { data, error } = await supabase.rpc('convert_requisition_to_po', {
    p_tenant: actor.tenantId,
    p_requisition: input.requisitionId,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }
  const rows = (data ?? []) as {
    out_po_id: string;
    out_supplier_id: string;
    out_line_count: number;
    out_applied: boolean;
  }[];

  revalidateRequisition(input.requisitionId);
  revalidatePath('/purchase-orders');
  return {
    ok: true,
    pos: rows.map((r) => ({
      poId: r.out_po_id,
      supplierId: r.out_supplier_id,
      lineCount: r.out_line_count,
    })),
    applied: rows.every((r) => r.out_applied),
  };
}

/**
 * Post-award link refresh (design §8): copy ONE awarded line's price + UoM
 * snapshot onto the supplier link, as an explicit, audited user action — never
 * automatic. Stale link costs are how valuation seeds and reorder math drift.
 */
export async function updateSupplierLinkPrice(input: {
  requisitionId: string;
  lineNo: number;
}): Promise<RfqEditState> {
  const supabase = await createSupabaseServer();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const { data: line } = await supabase
    .from('requisition_lines')
    .select('product_id, supplier_id, unit_cost, purchase_uom, purchase_to_stock_factor')
    .eq('requisition_id', input.requisitionId)
    .eq('line_no', input.lineNo)
    .maybeSingle<{
      product_id: string;
      supplier_id: string;
      unit_cost: number | null;
      purchase_uom: string | null;
      purchase_to_stock_factor: number | null;
    }>();
  if (!line) {
    return { ok: false, error: 'That requisition line no longer exists.' };
  }
  if (line.unit_cost == null) {
    return { ok: false, error: 'This line has no awarded price to copy.' };
  }

  const { error } = await supabase.from('product_suppliers').upsert({
    tenant_id: actor.tenantId,
    product_id: line.product_id,
    supplier_id: line.supplier_id,
    unit_cost: line.unit_cost,
    purchase_uom: line.purchase_uom,
    purchase_to_stock_factor: line.purchase_to_stock_factor,
  });
  if (error) {
    return { ok: false, error: mapRfqWriteError(error.code, error.message) };
  }

  revalidateRequisition(input.requisitionId);
  return { ok: true };
}
