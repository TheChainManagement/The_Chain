/**
 * Unit-of-measure reference (W2-1b). A curated set of common units, each with a
 * short code (stored on products.unit_of_measure), a friendly label, a category
 * for the picker's optgroups, and aliases that map legacy / free-text values
 * (e.g. "each", "Box", "kilogram") back onto a curated code. Operators pick from
 * these or use the "Other" escape hatch for anything bespoke — the column stays
 * free-form text, so custom and pre-existing values are never rejected, and the
 * resolver normalizes the known ones for display + round-trip editing.
 */

export interface UomOption {
  /** Stored value + abbreviation, e.g. "ea". */
  code: string;
  /** Friendly name, e.g. "Each". */
  label: string;
  /** Grouping for the picker, e.g. "Count". */
  category: string;
  /** Lowercase synonyms (incl. legacy free-text) that resolve to this code. */
  aliases: readonly string[];
}

export const UOM_OPTIONS: readonly UomOption[] = [
  { code: 'ea', label: 'Each', category: 'Count', aliases: ['each', 'unit', 'units', 'eaches'] },
  { code: 'pr', label: 'Pair', category: 'Count', aliases: ['pair', 'pairs'] },
  { code: 'dz', label: 'Dozen', category: 'Count', aliases: ['dozen'] },
  { code: 'pk', label: 'Pack', category: 'Count', aliases: ['pack', 'packs'] },
  { code: 'bx', label: 'Box', category: 'Count', aliases: ['box', 'boxes'] },
  { code: 'cs', label: 'Case', category: 'Count', aliases: ['case', 'cases'] },
  { code: 'pl', label: 'Pallet', category: 'Count', aliases: ['pallet', 'pallets'] },
  { code: 'rl', label: 'Roll', category: 'Count', aliases: ['roll', 'rolls'] },
  {
    code: 'kg',
    label: 'Kilogram',
    category: 'Weight',
    aliases: ['kilogram', 'kilograms', 'kilo', 'kgs'],
  },
  { code: 'g', label: 'Gram', category: 'Weight', aliases: ['gram', 'grams'] },
  { code: 'lb', label: 'Pound', category: 'Weight', aliases: ['pound', 'pounds', 'lbs'] },
  { code: 'oz', label: 'Ounce', category: 'Weight', aliases: ['ounce', 'ounces'] },
  {
    code: 'L',
    label: 'Liter',
    category: 'Volume',
    aliases: ['liter', 'litre', 'liters', 'litres'],
  },
  {
    code: 'mL',
    label: 'Milliliter',
    category: 'Volume',
    aliases: ['milliliter', 'millilitre', 'milliliters'],
  },
  { code: 'gal', label: 'Gallon', category: 'Volume', aliases: ['gallon', 'gallons'] },
  { code: 'qt', label: 'Quart', category: 'Volume', aliases: ['quart', 'quarts'] },
  {
    code: 'm',
    label: 'Meter',
    category: 'Length',
    aliases: ['meter', 'metre', 'meters', 'metres'],
  },
  { code: 'cm', label: 'Centimeter', category: 'Length', aliases: ['centimeter', 'centimetre'] },
  { code: 'ft', label: 'Foot', category: 'Length', aliases: ['foot', 'feet'] },
  { code: 'in', label: 'Inch', category: 'Length', aliases: ['inch', 'inches'] },
];

const BY_CODE = new Map(UOM_OPTIONS.map((o) => [o.code, o]));

// token (lowercased code OR alias) → canonical code. Lets legacy free-text and
// case variants resolve onto a curated unit.
const BY_TOKEN = new Map<string, string>();
for (const o of UOM_OPTIONS) {
  BY_TOKEN.set(o.code.toLowerCase(), o.code);
  for (const a of o.aliases) BY_TOKEN.set(a.toLowerCase(), o.code);
}

/** Resolve a stored value (code, alias, or legacy free-text) to a curated code, or null. */
export function resolveUomCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return BY_TOKEN.get(value.trim().toLowerCase()) ?? null;
}

/** True when a value resolves to a curated code (vs. a bespoke "other" value). */
export function isKnownUom(value: string | null | undefined): boolean {
  return resolveUomCode(value) !== null;
}

/**
 * Friendly display for a stored UoM value: the curated label for a known code or
 * alias ("ea"/"each" → "Each"), the raw value for a bespoke entry, "" for blank.
 */
export function uomLabel(value: string | null | undefined): string {
  if (!value) return '';
  const code = resolveUomCode(value);
  return code ? (BY_CODE.get(code)?.label ?? value) : value;
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
