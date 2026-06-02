'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';
import {
  formatOpenPoError,
  mapSupplierWriteError,
  OPEN_PO_STATUSES,
  PERMISSION_MESSAGE,
  validateLinkInput,
  validateSupplierInput,
} from '@/lib/suppliers/transform';

/**
 * Supplier + product-supplier mutations (Block 4).
 *
 * tenant_id comes from the verified JWT claim; RLS (`has_role('owner','manager',
 * 'planner')` for insert/update, owner-only delete) is the real gate. Archive is
 * a soft status flip, guarded against open POs. Validation + error mapping are
 * pure (transform.ts). Form-bound for useActionState.
 */

export type SupplierActionState =
  | { ok: true; supplierId: string }
  | { ok: false; error: string }
  | null;

export type LinkActionState = { ok: true } | { ok: false; error: string } | null;

type Server = Awaited<ReturnType<typeof createSupabaseServer>>;

async function resolveTenantId(supabase: Server): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.tenant_id as string | undefined) ?? null;
}

function parseIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseNumOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function createSupplier(
  _prev: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const leadTime = String(formData.get('default_lead_time_days') ?? '');
  const minOrder = String(formData.get('min_order_value') ?? '');

  const valid = validateSupplierInput({ name, defaultLeadTimeDays: leadTime });
  if (!valid.ok) {
    return valid;
  }

  const supabase = await createSupabaseServer();
  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const contact: Record<string, string> = {};
  if (email) {
    contact.email = email;
  }
  if (phone) {
    contact.phone = phone;
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      tenant_id: tenantId,
      name,
      contact,
      default_lead_time_days: parseIntOrNull(leadTime),
      min_order_value: parseNumOrNull(minOrder),
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: mapSupplierWriteError(error?.code, error?.message ?? '') };
  }

  revalidatePath('/suppliers');
  return { ok: true, supplierId: data.id };
}

export async function updateSupplier(
  _prev: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const leadTime = String(formData.get('default_lead_time_days') ?? '');
  const minOrder = String(formData.get('min_order_value') ?? '');

  if (!supplierId) {
    return { ok: false, error: 'Missing supplier reference.' };
  }
  const valid = validateSupplierInput({ name, defaultLeadTimeDays: leadTime });
  if (!valid.ok) {
    return valid;
  }

  const supabase = await createSupabaseServer();
  const contact: Record<string, string> = {};
  if (email) {
    contact.email = email;
  }
  if (phone) {
    contact.phone = phone;
  }

  const { data, error } = await supabase
    .from('suppliers')
    .update({
      name,
      contact,
      default_lead_time_days: parseIntOrNull(leadTime),
      min_order_value: parseNumOrNull(minOrder),
    })
    .eq('id', supplierId)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }
  if (!data) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  revalidatePath('/suppliers');
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true, supplierId };
}

export async function archiveSupplier(
  _prev: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  if (!supplierId) {
    return { ok: false, error: 'Missing supplier reference.' };
  }

  const supabase = await createSupabaseServer();

  // Guard: a supplier with open POs cannot be archived — name them so the user
  // knows what to close first. (No POs exist pre-Block-11; the guard is durable.)
  const { data: openPos, error: poError } = await supabase
    .from('purchase_orders')
    .select('id, external_po_id, status')
    .eq('supplier_id', supplierId)
    .in('status', [...OPEN_PO_STATUSES])
    .returns<{ id: string; external_po_id: string | null; status: string }[]>();

  if (poError) {
    return { ok: false, error: mapSupplierWriteError(poError.code, poError.message) };
  }
  if (openPos && openPos.length > 0) {
    const refs = openPos.map((p) => p.external_po_id ?? `PO-${p.id.slice(0, 8)}`);
    return { ok: false, error: formatOpenPoError(refs) };
  }

  const { data, error } = await supabase
    .from('suppliers')
    .update({ status: 'archived' })
    .eq('id', supplierId)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }
  if (!data) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  revalidatePath('/suppliers');
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true, supplierId };
}

/** Clear the current primary link for a product (so a new one can be set). */
async function clearPrimary(supabase: Server, productId: string): Promise<void> {
  await supabase
    .from('product_suppliers')
    .update({ is_primary: false })
    .eq('product_id', productId)
    .eq('is_primary', true);
}

export async function linkSupplier(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  const unitCost = String(formData.get('unit_cost') ?? '');
  const leadTime = String(formData.get('lead_time_days') ?? '');
  const moq = String(formData.get('moq') ?? '');
  const isPrimary = formData.get('is_primary') != null;

  if (!productId) {
    return { ok: false, error: 'Missing product reference.' };
  }
  const valid = validateLinkInput({ supplierId, unitCost, leadTimeDays: leadTime, moq });
  if (!valid.ok) {
    return valid;
  }

  const supabase = await createSupabaseServer();
  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  // Only one is_primary per (tenant, product) is enforced by a partial unique
  // index — clear the existing primary first so the insert can't collide.
  if (isPrimary) {
    await clearPrimary(supabase, productId);
  }

  const { error } = await supabase.from('product_suppliers').insert({
    tenant_id: tenantId,
    product_id: productId,
    supplier_id: supplierId,
    unit_cost: parseNumOrNull(unitCost),
    lead_time_days: parseIntOrNull(leadTime),
    moq: parseIntOrNull(moq),
    is_primary: isPrimary,
  });

  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }

  revalidatePath(`/inventory/${productId}`);
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true };
}

export async function setPrimarySupplier(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  if (!productId || !supplierId) {
    return { ok: false, error: 'Missing reference.' };
  }

  const supabase = await createSupabaseServer();
  await clearPrimary(supabase, productId);

  const { data, error } = await supabase
    .from('product_suppliers')
    .update({ is_primary: true })
    .eq('product_id', productId)
    .eq('supplier_id', supplierId)
    .select('product_id')
    .maybeSingle<{ product_id: string }>();

  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }
  if (!data) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  revalidatePath(`/inventory/${productId}`);
  return { ok: true };
}

export async function unlinkSupplier(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const supplierId = String(formData.get('supplier_id') ?? '').trim();
  if (!productId || !supplierId) {
    return { ok: false, error: 'Missing reference.' };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('product_suppliers')
    .delete()
    .eq('product_id', productId)
    .eq('supplier_id', supplierId)
    .select('product_id')
    .maybeSingle<{ product_id: string }>();

  if (error) {
    return { ok: false, error: mapSupplierWriteError(error.code, error.message) };
  }
  if (!data) {
    // Owner-only delete (RLS); a non-owner gets no row back.
    return { ok: false, error: 'Only an owner can remove a supplier link.' };
  }

  revalidatePath(`/inventory/${productId}`);
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: true };
}
