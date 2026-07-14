import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocationRow, LocationType } from './transform';

interface RawLocation {
  id: string;
  name: string;
  type: LocationType;
  location_kind: string | null;
  active: boolean;
  is_primary: boolean;
  created_at: string;
}

export async function listLocations(supabase: SupabaseClient): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('id, name, type, location_kind, active, is_primary, created_at')
    .order('active', { ascending: false })
    .order('is_primary', { ascending: false })
    .order('name')
    .returns<RawLocation[]>();
  if (error) throw new Error(`listLocations failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    locationKind: row.location_kind,
    active: row.active,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  }));
}
