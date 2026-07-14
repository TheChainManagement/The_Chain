export const LOCATION_TYPES = [
  'warehouse',
  'store',
  'plant',
  'third_party',
  'consignment',
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export interface LocationRow {
  id: string;
  name: string;
  type: LocationType;
  locationKind: string | null;
  active: boolean;
  isPrimary: boolean;
  createdAt: string;
}

export function validateLocationInput(input: {
  name: string;
  type: string;
}): { ok: true } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Location name is required.' };
  if (name.length > 120)
    return { ok: false, error: 'Location name must be 120 characters or fewer.' };
  if (!LOCATION_TYPES.includes(input.type as LocationType)) {
    return { ok: false, error: 'Choose a valid location type.' };
  }
  return { ok: true };
}

export function mapLocationError(message: string): string {
  if (/locations_active_name_unique/i.test(message))
    return 'An active location already uses that name.';
  if (/Choose another primary/i.test(message))
    return 'Choose another primary location before archiving this one.';
  if (/non-zero inventory/i.test(message))
    return 'Move or clear this location’s inventory before archiving it.';
  if (/open purchase order/i.test(message))
    return 'Close this location’s open purchase orders before archiving it.';
  if (/open procurement document/i.test(message))
    return 'Close this location’s RFQs and requisitions before archiving it.';
  if (/open cycle count/i.test(message))
    return 'Complete or cancel this location’s open cycle count before archiving it.';
  if (/row-level security|not authorized|permission/i.test(message))
    return 'Only an owner or manager can manage locations.';
  return `Location could not be saved: ${message}`;
}
