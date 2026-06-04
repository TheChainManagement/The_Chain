/**
 * CSV parsing (Block 5) — a thin, deterministic wrapper over papaparse.
 *
 * Pure and isomorphic: the client parses for the mapping preview, and the server
 * re-parses the same text authoritatively at commit (the client-parsed result is
 * never trusted). Header mode is on, empty lines skipped, values kept as strings
 * so `transform.ts` owns all coercion.
 *
 * Wave 5.1 handles UTF-8 (+ BOM, which papaparse strips) and the common Excel
 * dialects papaparse detects (quoted commas, embedded newlines, CR/CRLF). Latin-1
 * re-decoding + a hard streaming path for 50k rows are Wave 5.2 (ticketed).
 */

import Papa from 'papaparse';

export interface ParsedCsv {
  headers: string[];
  /** Row objects keyed by header. Order preserved. */
  rows: Record<string, string>[];
  rowCount: number;
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** Strip a leading UTF-8 BOM if papaparse hasn't already. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = stripBom(text);
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    // Keep everything as strings; transform.ts coerces per field type.
    dynamicTyping: false,
  });

  // A header row that fails to parse at all is fatal. Per-row field errors are
  // not: papaparse reports them in result.errors with a row index, and we let
  // the validation pass surface bad rows instead of failing the whole file.
  const fatal = result.errors.find((e) => e.type === 'Delimiter' || e.row === undefined);
  if (fatal) {
    throw new CsvParseError(`Could not read this CSV: ${fatal.message}`);
  }

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  if (headers.length === 0) {
    throw new CsvParseError('This file has no column headers in the first row.');
  }

  return {
    headers,
    rows: result.data,
    rowCount: result.data.length,
  };
}
