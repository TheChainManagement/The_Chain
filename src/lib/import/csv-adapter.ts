/**
 * CsvSourceAdapter (Block 5) — the universal-fallback `SourceAdapter`.
 *
 * Same contract as the native QBO adapter, so everything downstream (workflow
 * steps, the commit path, forecasting) reads canonical payloads and never knows
 * the data came from a spreadsheet. The adapter is constructed per upload session
 * with the raw CSV text + the user's column mapping for each kind; `pull()` parses
 * + maps + validates and returns canonical payloads with per-row errors attached.
 *
 * Read-only: `push()` throws `FatalError`. Capabilities advertise the importable
 * kinds (FEATURES.md Block 5). Wave 5.1 parses single-shot (`nextCursor: null`);
 * cursor-based chunking for the 50k stress path is Wave 5.2.
 */

import {
  type AdapterCapabilities,
  type CanonicalPayload,
  type Cursor,
  type EntityKind,
  FatalError,
  type PullResult,
  type PullResultError,
  type PushResult,
  type SourceAdapter,
} from '@/lib/source-adapter';
import { getKindSpec, type ImportableKind } from './field-specs';
import type { ColumnMapping } from './mapping';
import { parseCsv } from './parse';
import { mapRows, type RowError } from './transform';

export interface CsvSource {
  csvText: string;
  mapping: ColumnMapping;
}

export type CsvSources = Partial<Record<ImportableKind, CsvSource>>;

const CSV_CAPABILITIES: AdapterCapabilities = {
  readProducts: true,
  readSuppliers: true,
  readProductSuppliers: true,
  readInventory: false,
  readPurchaseOrders: false,
  readStockMovements: true,
  writePurchaseOrders: false,
  webhooks: false,
};

const IMPORTABLE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'product',
  'supplier',
  'product_supplier',
  'stock_movement',
]);

function isImportableKind(kind: EntityKind): kind is ImportableKind {
  return IMPORTABLE_KINDS.has(kind);
}

function toPullError(error: RowError): PullResultError {
  return {
    externalId: String(error.row),
    row: error.row,
    code: error.code,
    message: error.message,
  };
}

export class CsvSourceAdapter implements SourceAdapter {
  readonly source = 'csv' as const;
  readonly capabilities = CSV_CAPABILITIES;

  constructor(private readonly sources: CsvSources) {}

  async pull<E extends EntityKind>(
    kind: E,
    _cursor: Cursor | null,
    _idempotencyKey: string,
  ): Promise<PullResult<E>> {
    if (!isImportableKind(kind)) {
      throw new FatalError(`CSV import does not support "${kind}".`, { code: 'unsupported_kind' });
    }

    const src = this.sources[kind];
    if (!src) {
      return { items: [], nextCursor: null, errors: [] };
    }

    const parsed = parseCsv(src.csvText);
    const { payloads, errors } = mapRows(parsed.rows, getKindSpec(kind), src.mapping);

    return {
      // mapRows is keyed by `spec.kind === kind`, so every payload is CanonicalPayload<E>.
      items: payloads as CanonicalPayload<E>[],
      nextCursor: null,
      errors: errors.map(toPullError),
    };
  }

  async push(
    _kind: 'purchase_order',
    _payload: CanonicalPayload<'purchase_order'>,
    _idempotencyKey: string,
  ): Promise<PushResult> {
    throw new FatalError('The CSV source is read-only; it cannot write purchase orders.', {
      code: 'write_unsupported',
    });
  }
}
