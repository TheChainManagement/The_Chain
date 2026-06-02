'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Inventory master-data mutations (Block 3).
 *
 * tenant_id is read from the verified JWT claim and written explicitly; RLS
 * (`with check (tenant_id = jwt_tenant_id() and has_role('owner','manager',
 * 'planner'))`) is the real authority — a viewer/warehouse role is rejected at
 * the data layer, not here. Archive is a soft status flip, never a hard delete.
 *
 * Form-bound for `useActionState`: each takes (prevState, FormData) and returns
 * the result union (no redirect) so the client island can revalidate in place.
 */

export type ProductActionState =
  | { ok: true; productId: string }
  | { ok: false; error: string }
  | null;

const PERMISSION_MESSAGE =
  'You do not have permission to change the catalog. Ask an owner or manager.';

function mapWriteError(code: string | undefined, message: string): string {
  if (code === '23505') {
    return 'A product with that SKU already exists in your catalog.';
  }
  // RLS rejection (role gate / tenant mismatch) surfaces as 42501 or the policy text.
  if (code === '42501' || /row-level security/i.test(message)) {
    return PERMISSION_MESSAGE;
  }
  return 'Could not save the product. Please try again.';
}

async function resolveTenantId(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.tenant_id as string | undefined) ?? null;
}

export async function createProduct(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const sku = String(formData.get('sku') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const unitOfMeasure = String(formData.get('unit_of_measure') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  if (!sku) {
    return { ok: false, error: 'SKU is required.' };
  }
  if (!name) {
    return { ok: false, error: 'Product name is required.' };
  }

  const supabase = await createSupabaseServer();
  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id: tenantId,
      sku,
      name,
      unit_of_measure: unitOfMeasure || null,
      description: description || null,
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: mapWriteError(error?.code, error?.message ?? '') };
  }

  revalidatePath('/inventory');
  return { ok: true, productId: data.id };
}

export async function updateProduct(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const unitOfMeasure = String(formData.get('unit_of_measure') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();

  if (!productId) {
    return { ok: false, error: 'Missing product reference.' };
  }
  if (!name) {
    return { ok: false, error: 'Product name is required.' };
  }

  const supabase = await createSupabaseServer();
  // RLS scopes the update to the caller's tenant + role; no tenant filter needed.
  const { data, error } = await supabase
    .from('products')
    .update({
      name,
      unit_of_measure: unitOfMeasure || null,
      description: description || null,
    })
    .eq('id', productId)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    return { ok: false, error: mapWriteError(error.code, error.message) };
  }
  if (!data) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
  return { ok: true, productId };
}

export async function archiveProduct(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  if (!productId) {
    return { ok: false, error: 'Missing product reference.' };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('products')
    .update({ status: 'discontinued' })
    .eq('id', productId)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    return { ok: false, error: mapWriteError(error.code, error.message) };
  }
  if (!data) {
    return { ok: false, error: PERMISSION_MESSAGE };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
  return { ok: true, productId };
}
