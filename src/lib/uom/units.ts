/**
 * Unit-of-measure reference (W2-1b). A curated set of common units, each with a
 * short code (stored on products.unit_of_measure) and a friendly label, grouped
 * by category for the picker's optgroups. Operators pick from these or use the
 * "Other" escape hatch for anything bespoke — the column stays free-form text, so
 * custom units and pre-existing values are never rejected.
 */

export interface UomOption {
  /** Stored value + abbreviation, e.g. "ea". */
  code: string;
  /** Friendly name, e.g. "Each". */
  label: string;
  /** Grouping for the picker, e.g. "Count". */
  category: string;
}

export const UOM_OPTIONS: readonly UomOption[] = [
  { code: 'ea', label: 'Each', category: 'Count' },
  { code: 'pr', label: 'Pair', category: 'Count' },
  { code: 'dz', label: 'Dozen', category: 'Count' },
  { code: 'pk', label: 'Pack', category: 'Count' },
  { code: 'bx', label: 'Box', category: 'Count' },
  { code: 'cs', label: 'Case', category: 'Count' },
  { code: 'pl', label: 'Pallet', category: 'Count' },
  { code: 'rl', label: 'Roll', category: 'Count' },
  { code: 'kg', label: 'Kilogram', category: 'Weight' },
  { code: 'g', label: 'Gram', category: 'Weight' },
  { code: 'lb', label: 'Pound', category: 'Weight' },
  { code: 'oz', label: 'Ounce', category: 'Weight' },
  { code: 'L', label: 'Liter', category: 'Volume' },
  { code: 'mL', label: 'Milliliter', category: 'Volume' },
  { code: 'gal', label: 'Gallon', category: 'Volume' },
  { code: 'qt', label: 'Quart', category: 'Volume' },
  { code: 'm', label: 'Meter', category: 'Length' },
  { code: 'cm', label: 'Centimeter', category: 'Length' },
  { code: 'ft', label: 'Foot', category: 'Length' },
  { code: 'in', label: 'Inch', category: 'Length' },
];

const BY_CODE = new Map(UOM_OPTIONS.map((o) => [o.code, o]));

/** True when a stored value is one of the curated codes (vs. a custom "other"). */
export function isKnownUom(value: string | null | undefined): boolean {
  return value != null && BY_CODE.has(value);
}

/**
 * Friendly display for a stored UoM value: the curated label for a known code
 * ("ea" → "Each"), the raw value for a custom/legacy entry, and "" for blank.
 */
export function uomLabel(value: string | null | undefined): string {
  if (!value) return '';
  return BY_CODE.get(value)?.label ?? value;
}

/** Curated options grouped by category, in declared order, for the picker. */
export function uomOptionGroups(): { category: string; options: UomOption[] }[] {
  const groups: { category: string; options: UomOption[] }[] = [];
  for (const option of UOM_OPTIONS) {
    const last = groups[groups.length - 1];
    if (last && last.category === option.category) last.options.push(option);
    else groups.push({ category: option.category, options: [option] });
  }
  return groups;
}
