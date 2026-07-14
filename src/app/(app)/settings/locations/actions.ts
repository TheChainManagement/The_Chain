'use server';

import { revalidatePath } from 'next/cache';
import {
  type LocationType,
  mapLocationError,
  validateLocationInput,
} from '@/lib/locations/transform';
import { createSupabaseServer } from '@/lib/supabase/server';

export type LocationActionState = { ok: true } | { ok: false; error: string } | null;

async function tenantId(): Promise<{
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>;
  tenantId: string;
} | null> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.tenant_id as string | undefined;
  return id ? { supabase, tenantId: id } : null;
}

function refresh(): void {
  revalidatePath('/settings');
  revalidatePath('/settings/locations');
}

export async function createLocation(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'warehouse');
  const locationKind = String(formData.get('location_kind') ?? '').trim() || null;
  const valid = validateLocationInput({ name, type });
  if (!valid.ok) return valid;
  const auth = await tenantId();
  if (!auth) return { ok: false, error: 'Only an owner or manager can manage locations.' };
  const { error } = await auth.supabase.from('locations').insert({
    tenant_id: auth.tenantId,
    name,
    type: type as LocationType,
    location_kind: locationKind,
    active: true,
  });
  if (error) return { ok: false, error: mapLocationError(error.message) };
  refresh();
  return { ok: true };
}

export async function updateLocation(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const id = String(formData.get('location_id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'warehouse');
  const locationKind = String(formData.get('location_kind') ?? '').trim() || null;
  const valid = validateLocationInput({ name, type });
  if (!id) return { ok: false, error: 'Missing location reference.' };
  if (!valid.ok) return valid;
  const auth = await tenantId();
  if (!auth) return { ok: false, error: 'Only an owner or manager can manage locations.' };
  const { data, error } = await auth.supabase
    .from('locations')
    .update({ name, type: type as LocationType, location_kind: locationKind })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: mapLocationError(error.message) };
  if (!data) return { ok: false, error: 'Only an owner or manager can manage locations.' };
  refresh();
  return { ok: true };
}

export async function makePrimary(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const locationId = String(formData.get('location_id') ?? '');
  const auth = await tenantId();
  if (!locationId || !auth)
    return { ok: false, error: 'Only an owner or manager can manage locations.' };
  const { error } = await auth.supabase.rpc('set_primary_location', {
    p_tenant: auth.tenantId,
    p_location: locationId,
  });
  if (error) return { ok: false, error: mapLocationError(error.message) };
  refresh();
  return { ok: true };
}

export async function archiveLocation(
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const id = String(formData.get('location_id') ?? '');
  if (!id) return { ok: false, error: 'Missing location reference.' };
  const auth = await tenantId();
  if (!auth) return { ok: false, error: 'Only an owner or manager can manage locations.' };
  const { data, error } = await auth.supabase
    .from('locations')
    .update({ active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: mapLocationError(error.message) };
  if (!data) return { ok: false, error: 'Only an owner or manager can manage locations.' };
  refresh();
  return { ok: true };
}
