/**
 * Storeroom operator vocabulary (W2-2) — pure constants, importable from client
 * islands (dropdowns) and the server posting layer alike. MG-locked decisions
 * (kickoff Status 2026-07-07): consuming-object types are work_order | crew |
 * cost_center; the issue form carries a reason dropdown + free-text note.
 */

/** Consuming-object types the demand-ref envelope accepts. */
export const DEMAND_REF_TYPES = [
  { value: 'work_order', label: 'Work order', placeholder: 'WO-10482' },
  { value: 'crew', label: 'Crew', placeholder: 'Crew B / Nights' },
  { value: 'cost_center', label: 'Cost center', placeholder: 'CC-4400' },
] as const;
export type DemandRefType = (typeof DEMAND_REF_TYPES)[number]['value'];

/** Issue-form reason codes. */
export const ISSUE_REASONS = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repair', label: 'Repair' },
  { value: 'scrap', label: 'Scrap' },
  { value: 'other', label: 'Other' },
] as const;

/** Adjustment reason codes — corrections have their own vocabulary. */
export const ADJUSTMENT_REASONS = [
  { value: 'damage', label: 'Damage' },
  { value: 'shrinkage', label: 'Shrinkage' },
  { value: 'found', label: 'Found stock' },
  { value: 'correction', label: 'Data correction' },
  { value: 'other', label: 'Other' },
] as const;

export function isDemandRefType(v: string): v is DemandRefType {
  return DEMAND_REF_TYPES.some((t) => t.value === v);
}
