/**
 * SourceAdapter contract — the seam every integration implements.
 *
 * Source: SYSTEM_DESIGN.md §Source-adapter contract.
 *
 * Adapters in scope:
 *   - QboSourceAdapter   (Wave 1, native two-way)
 *   - CsvSourceAdapter   (Wave 1, universal fallback; same contract)
 *   - RutterSourceAdapter (Wave 5; aggregator across NetSuite, Acumatica,
 *                          Sage Intacct, D365 BC, Xero, Shopify, Square, Clover)
 *   - Cin7/Fishbowl/Katana/ZohoInventory/Unleashed (Wave 7+; per-customer paid)
 *
 * Every adapter is required to be safe under retry: re-calling pull or push
 * with the same idempotencyKey MUST produce the same external state.
 */

import type {
  ProductAttributes,
  SupplierAttributes,
  ProductSupplierAttributes,
  PurchaseOrderAttributes,
  InventoryLevelAttributes,
  StockMovementAttributes,
} from './canonical';

export * from './errors';
export * as canonical from './canonical';
export { CANONICAL_SCHEMA_VERSION } from './canonical';

// ----- Entity + source enumerations -----

export type EntityKind =
  | 'product'
  | 'supplier'
  | 'product_supplier'
  | 'purchase_order'
  | 'inventory_level'
  | 'stock_movement';

export type AdapterSource =
  | 'qbo'
  | 'rutter'
  | 'csv'
  | 'cin7'
  | 'fishbowl'
  | 'katana'
  | 'zoho'
  | 'unleashed';

export type CanonicalAttributesByKind = {
  product: ProductAttributes;
  supplier: SupplierAttributes;
  product_supplier: ProductSupplierAttributes;
  purchase_order: PurchaseOrderAttributes;
  inventory_level: InventoryLevelAttributes;
  stock_movement: StockMovementAttributes;
};

// ----- Cursor + capabilities -----

/**
 * Opaque source-specific pagination/incremental marker. Persisted in
 * `sync_runs.cursor` between workflow steps so a sync can resume after
 * a crash without re-reading already-imported records.
 */
export interface Cursor {
  raw: unknown;
  /** ISO timestamp marking the latest external_updated_at observed. */
  highWatermark?: string;
}

/**
 * Capabilities the adapter exposes. Stored at connect time in
 * `source_connections.capabilities`. UI features (e.g., write-back POs)
 * are gated on these flags so a future adapter without `writePurchaseOrders`
 * simply hides the option.
 */
export interface AdapterCapabilities {
  readProducts: boolean;
  readSuppliers: boolean;
  readProductSuppliers: boolean;
  readInventory: boolean;
  readPurchaseOrders: boolean;
  readStockMovements: boolean;
  writePurchaseOrders: boolean;
  webhooks: boolean;
}

// ----- Payloads -----

/**
 * The shape downstream code sees. Adapters validate inputs against
 * `canonicalSchemasByKind[kind]` before returning.
 */
export interface CanonicalPayload<E extends EntityKind = EntityKind> {
  kind: E;
  externalId: string;
  externalUpdatedAt?: string;
  attributes: CanonicalAttributesByKind[E];
  schemaVersion: number;
}

export interface PullResultError {
  externalId?: string;
  code: string;
  message: string;
}

export interface PullResult<E extends EntityKind = EntityKind> {
  items: CanonicalPayload<E>[];
  nextCursor: Cursor | null;
  errors: PullResultError[];
}

export interface PushResult {
  externalId: string;
  externalVersion: number;
  appliedAt: string;  // ISO
}

// ----- The contract -----

export interface SourceAdapter {
  readonly source: AdapterSource;
  readonly capabilities: AdapterCapabilities;

  /**
   * Read `kind` records from the source. `cursor` resumes from a prior pull.
   * `idempotencyKey` lets the adapter dedupe in-flight requests on retry.
   */
  pull<E extends EntityKind>(
    kind: E,
    cursor: Cursor | null,
    idempotencyKey: string,
  ): Promise<PullResult<E>>;

  /**
   * Write back a generated PO to the external system. Only `purchase_order`
   * is supported in Wave 1. Other kinds may be added when capability flags
   * are extended.
   */
  push(
    kind: 'purchase_order',
    payload: CanonicalPayload<'purchase_order'>,
    idempotencyKey: string,
  ): Promise<PushResult>;

  /**
   * Optional: convert a webhook event (e.g., Intuit entity-changed) into
   * canonical payloads so the workflow can apply the same write paths as
   * a pull cycle. Implemented when `capabilities.webhooks === true`.
   */
  ingestWebhook?(event: unknown, idempotencyKey: string): Promise<CanonicalPayload[]>;
}
