/**
 * Row → canonical payload (Block 5).
 *
 * Takes a parsed CSV row + the column mapping and produces a `CanonicalPayload`
 * the adapter can return, OR a structured row error. Coercion is per field type
 * (number/integer/enum/string); the canonical Zod schema is the final authority,
 * so a value that coerces but still violates the schema (negative cost, unknown
 * enum) is caught here, not at the DB.
 *
 * Pure + isomorphic — no server-only imports — so it unit-tests directly and runs
 * the same in the client preview and the server commit.
 */

import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalPayload,
  canonical,
  type EntityKind,
} from '@/lib/source-adapter';
import type { CanonicalFieldSpec, ImportableKind, KindSpec } from './field-specs';
import { naturalKeyField } from './field-specs';
import type { ColumnMapping } from './mapping';

export interface RowError {
  /** 1-based CSV row number (data rows, header excluded). */
  row: number;
  field?: string;
  code: 'missing_required' | 'invalid_number' | 'invalid_integer' | 'invalid_enum' | 'schema';
  message: string;
}

export interface RowResult<E extends EntityKind = EntityKind> {
  row: number;
  payload: CanonicalPayload<E> | null;
  errors: RowError[];
}

const NUMERIC_CLEAN = /[\s,$]/g;

function coerceNumber(raw: string): number | null {
  const cleaned = raw.replace(NUMERIC_CLEAN, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one mapped row into `{ key: value }` canonical attributes, collecting any
 * coercion errors. Blank optional cells are dropped (schema treats them as
 * absent); blank required cells become a `missing_required` error.
 */
function buildAttributes(
  rowNo: number,
  row: Record<string, string>,
  spec: KindSpec,
  mapping: ColumnMapping,
): { attributes: Record<string, unknown>; errors: RowError[] } {
  const attributes: Record<string, unknown> = {};
  const errors: RowError[] = [];

  for (const field of spec.fields) {
    const header = mapping[field.key];
    const rawValue = header ? (row[header] ?? '').trim() : '';

    if (rawValue === '') {
      if (field.required) {
        errors.push({
          row: rowNo,
          field: field.key,
          code: 'missing_required',
          message: `${field.label} is required but blank.`,
        });
      } else if (field.type === 'enum' && field.enumValues) {
        // Default the optional enum (e.g. status -> active) so the schema passes.
        attributes[field.key] = field.enumValues[0];
      }
      continue;
    }

    const coerced = coerceValue(field, rawValue, rowNo, errors);
    if (coerced !== undefined) {
      attributes[field.key] = coerced;
    }
  }

  return { attributes, errors };
}

function coerceValue(
  field: CanonicalFieldSpec,
  rawValue: string,
  rowNo: number,
  errors: RowError[],
): unknown {
  switch (field.type) {
    case 'number': {
      const n = coerceNumber(rawValue);
      if (n === null) {
        errors.push({
          row: rowNo,
          field: field.key,
          code: 'invalid_number',
          message: `${field.label} must be a number; got "${rawValue}".`,
        });
        return undefined;
      }
      return n;
    }
    case 'integer': {
      const n = coerceNumber(rawValue);
      if (n === null || !Number.isInteger(n)) {
        errors.push({
          row: rowNo,
          field: field.key,
          code: 'invalid_integer',
          message: `${field.label} must be a whole number; got "${rawValue}".`,
        });
        return undefined;
      }
      return n;
    }
    case 'enum': {
      const value = rawValue.toLowerCase().replace(/[\s-]/g, '_');
      if (field.enumValues && !field.enumValues.includes(value)) {
        errors.push({
          row: rowNo,
          field: field.key,
          code: 'invalid_enum',
          message: `${field.label} must be one of ${field.enumValues.join(', ')}; got "${rawValue}".`,
        });
        return undefined;
      }
      return value;
    }
    default:
      return rawValue;
  }
}

/**
 * Map one row to a canonical payload. Returns `payload: null` with errors when
 * coercion or the canonical schema rejects it. The natural-key cell supplies
 * `externalId` (also used for the idempotent upsert key).
 */
export function rowToPayload(
  rowNo: number,
  row: Record<string, string>,
  spec: KindSpec,
  mapping: ColumnMapping,
): RowResult {
  const { attributes, errors } = buildAttributes(rowNo, row, spec, mapping);

  const keyField = naturalKeyField(spec.kind);
  const keyHeader = mapping[keyField.key];
  const externalId = keyHeader ? (row[keyHeader] ?? '').trim() : '';

  if (errors.length > 0) {
    return { row: rowNo, payload: null, errors };
  }

  const schema = canonical.canonicalSchemasByKind[spec.kind];
  const parsed = schema.safeParse(attributes);
  if (!parsed.success) {
    return {
      row: rowNo,
      payload: null,
      errors: parsed.error.issues.map((issue) => ({
        row: rowNo,
        field: issue.path.join('.') || undefined,
        code: 'schema' as const,
        message: issue.message,
      })),
    };
  }

  return {
    row: rowNo,
    payload: {
      kind: spec.kind,
      externalId,
      attributes: parsed.data,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
    },
    errors: [],
  };
}

export interface MapRowsResult<E extends EntityKind = EntityKind> {
  payloads: CanonicalPayload<E>[];
  errors: RowError[];
  total: number;
}

/**
 * Map every row. Valid rows accumulate in `payloads`; bad rows contribute to
 * `errors` without blocking the good ones (the import contract: failures don't
 * stop valid rows).
 */
export function mapRows(
  rows: Record<string, string>[],
  spec: KindSpec,
  mapping: ColumnMapping,
): MapRowsResult {
  const payloads: CanonicalPayload[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, i) => {
    const result = rowToPayload(i + 1, row, spec, mapping);
    if (result.payload) {
      payloads.push(result.payload);
    } else {
      errors.push(...result.errors);
    }
  });

  return { payloads, errors, total: rows.length };
}

export type { ImportableKind };
