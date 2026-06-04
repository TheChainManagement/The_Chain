/**
 * Column mapping (Block 5) — CSV header ↔ canonical field.
 *
 * `ColumnMapping` is field-key → CSV-header (or null when unmapped). The
 * default-from-name heuristic pre-wires obvious columns so the pegboard opens
 * with cobalt connectors already drawn; the user only fixes what's wrong.
 */

import type { CanonicalFieldSpec, KindSpec } from './field-specs';

/** field key -> chosen CSV header (null = not mapped). */
export type ColumnMapping = Record<string, string | null>;

/** Lowercase, strip everything but a–z0–9 so "Unit Cost" == "unit_cost". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build the initial mapping by matching each canonical field's aliases against
 * the normalized CSV headers. Exact-normalized match on the field key or label
 * wins first; then the alias list, in order. A header is only ever used once
 * (first field to claim it keeps it), so two fields can't fight over one column.
 */
export function autoMap(headers: string[], spec: KindSpec): ColumnMapping {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const claimed = new Set<string>();
  const mapping: ColumnMapping = {};

  for (const field of spec.fields) {
    mapping[field.key] = matchField(field, normalized, claimed);
  }
  return mapping;
}

function matchField(
  field: CanonicalFieldSpec,
  headers: { raw: string; norm: string }[],
  claimed: Set<string>,
): string | null {
  const candidates = [
    normalizeHeader(field.key),
    normalizeHeader(field.label),
    ...field.aliases.map(normalizeHeader),
  ];
  for (const candidate of candidates) {
    const hit = headers.find((h) => h.norm === candidate && !claimed.has(h.raw));
    if (hit) {
      claimed.add(hit.raw);
      return hit.raw;
    }
  }
  return null;
}

/** Headers not wired to any field — shown as available ports on the pegboard. */
export function unmappedHeaders(headers: string[], mapping: ColumnMapping): string[] {
  const used = new Set(Object.values(mapping).filter((v): v is string => v !== null));
  return headers.filter((h) => !used.has(h));
}

/** Required fields with no column wired — blocks commit until resolved. */
export function missingRequired(spec: KindSpec, mapping: ColumnMapping): CanonicalFieldSpec[] {
  return spec.fields.filter((f) => f.required && !mapping[f.key]);
}
