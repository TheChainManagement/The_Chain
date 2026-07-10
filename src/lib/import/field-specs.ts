/**
 * Canonical field descriptors for CSV import (Block 5).
 *
 * One spec per importable EntityKind. The spec is the single source that drives
 * BOTH the column-mapping UI (which canonical fields show on the pegboard, which
 * are required) AND the coercion/validation in `transform.ts` (how each mapped
 * cell is turned into a canonical attribute before the Zod schema checks it).
 *
 * `aliases` feed the default-from-name heuristic: a CSV header that normalizes
 * to one of these wires itself to the field automatically (a pre-drawn cobalt
 * connector the user can override).
 *
 * Wave 5.1 ships the `product` flow end to end; `supplier` and `stock_movement`
 * specs are defined now (the adapter reads all three) so the later UI waves are
 * config, not a rebuild.
 */

import type { EntityKind } from '@/lib/source-adapter';

export type ImportableKind = Extract<
  EntityKind,
  'product' | 'supplier' | 'product_supplier' | 'stock_movement'
>;

export type FieldType = 'string' | 'number' | 'integer' | 'enum';

export interface CanonicalFieldSpec {
  /** Canonical attribute key (matches the Zod schema field). */
  key: string;
  /** Mono-caps label shown on the pegboard. */
  label: string;
  required: boolean;
  type: FieldType;
  /** Allowed values for an enum field; the first is the default when blank. */
  enumValues?: readonly string[];
  /** Normalized header fragments that auto-wire to this field. */
  aliases: readonly string[];
  /** Short hint shown under the field. */
  hint?: string;
  /**
   * This field is the natural key / external id for the row (used for
   * idempotent upsert and to label failures). Exactly one per kind.
   */
  isNaturalKey?: boolean;
  /**
   * The natural key is matched case-insensitively (e.g. supplier name, which
   * upserts on `lower(name)`). In-file de-dup folds case to match the DB key.
   * SKUs are codes and stay case-sensitive.
   */
  caseFold?: boolean;
  /**
   * The natural key uniquely identifies a row, so a repeat in one file is a
   * mistake (products, suppliers). Default true. Movements set this false: a SKU
   * appears in every sale of that product, so rows are NOT deduped on it — true
   * duplicates are collapsed downstream by the content-hash source_ref instead.
   */
  rowUnique?: boolean;
}

export interface KindSpec {
  kind: ImportableKind;
  /** Surface label, e.g. "Products". */
  label: string;
  /** One-line description of what a row becomes. */
  blurb: string;
  fields: readonly CanonicalFieldSpec[];
}

const PRODUCT_FIELDS: readonly CanonicalFieldSpec[] = [
  {
    key: 'sku',
    label: 'SKU',
    required: true,
    type: 'string',
    isNaturalKey: true,
    aliases: ['sku', 'item', 'itemnumber', 'itemno', 'partnumber', 'partno', 'code', 'productcode'],
    hint: 'Unique per catalog. Re-importing the same SKU updates it, never duplicates.',
  },
  {
    key: 'name',
    label: 'Name',
    required: true,
    type: 'string',
    aliases: ['name', 'productname', 'itemname', 'title', 'product', 'description'],
  },
  {
    key: 'description',
    label: 'Description',
    required: false,
    type: 'string',
    aliases: ['description', 'desc', 'details', 'longdescription', 'notes'],
  },
  {
    key: 'unitOfMeasure',
    label: 'Unit of measure',
    required: false,
    type: 'string',
    aliases: ['uom', 'unit', 'unitofmeasure', 'measure', 'units'],
  },
  {
    key: 'status',
    label: 'Status',
    required: false,
    type: 'enum',
    enumValues: ['active', 'discontinued'],
    aliases: ['status', 'state', 'active'],
    hint: 'Defaults to active when blank.',
  },
];
// Note: a product's cost is supplier-specific (product_suppliers.unit_cost), not a
// column on products, so unitCost is intentionally not a product import field. It
// arrives with suppliers / product-supplier links in a later wave.

const SUPPLIER_FIELDS: readonly CanonicalFieldSpec[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    type: 'string',
    isNaturalKey: true,
    caseFold: true,
    aliases: ['name', 'supplier', 'vendor', 'suppliername', 'vendorname', 'company'],
    hint: 'Matched case-insensitively. Re-importing the same supplier updates it, never duplicates.',
  },
  {
    key: 'defaultLeadTimeDays',
    label: 'Lead time (days)',
    required: false,
    type: 'integer',
    aliases: ['leadtime', 'leadtimedays', 'leaddays', 'days'],
  },
  {
    key: 'minOrderValue',
    label: 'Min order value',
    required: false,
    type: 'number',
    aliases: ['minordervalue', 'minorder', 'moq', 'minimum'],
  },
  {
    key: 'status',
    label: 'Status',
    required: false,
    type: 'enum',
    enumValues: ['active', 'archived'],
    aliases: ['status', 'state'],
    hint: 'Defaults to active when blank.',
  },
];

const PRODUCT_SUPPLIER_FIELDS: readonly CanonicalFieldSpec[] = [
  {
    key: 'productExternalId',
    label: 'SKU',
    required: true,
    type: 'string',
    isNaturalKey: true,
    // A SKU recurs across each of its supplier links, so we don't dedup on it
    // alone; the (tenant, product, supplier) PK makes the upsert idempotent.
    rowUnique: false,
    aliases: ['sku', 'item', 'itemnumber', 'productcode', 'product', 'partnumber'],
    hint: 'Must match a SKU already in your catalog.',
  },
  {
    key: 'supplierExternalId',
    label: 'Supplier',
    required: true,
    type: 'string',
    aliases: ['supplier', 'vendor', 'suppliername', 'vendorname', 'company'],
    hint: 'Must match a supplier already on file. Matched case-insensitively.',
  },
  {
    key: 'unitCost',
    label: 'Unit cost',
    // Required: the engine reads cost basis from a link; a pricing row without it
    // is useless (FEATURES Block 2 minimum-field set for product_supplier links).
    required: true,
    type: 'number',
    aliases: ['cost', 'unitcost', 'price', 'unitprice', 'buyprice'],
  },
  {
    key: 'leadTimeDays',
    label: 'Lead time (days)',
    // Required: policy safety-stock/ROP need a per-link lead time (FEATURES Block 2).
    required: true,
    type: 'integer',
    aliases: ['leadtime', 'leadtimedays', 'leaddays', 'lead', 'days'],
  },
  {
    key: 'moq',
    label: 'MOQ',
    required: false,
    type: 'integer',
    aliases: ['moq', 'minorderqty', 'minimumorderquantity', 'minqty', 'minimumqty'],
  },
  {
    key: 'supplierSku',
    label: 'Supplier SKU',
    required: false,
    type: 'string',
    aliases: ['suppliersku', 'vendorsku', 'supplierpart', 'vendorpart', 'supplierpartnumber'],
    hint: "The supplier's own part number for this item.",
  },
  {
    key: 'purchaseUom',
    label: 'Purchase unit',
    required: false,
    type: 'string',
    aliases: ['purchaseuom', 'purchaseunit', 'buyunit', 'caseunit', 'orderunit'],
    hint: 'Unit this supplier sells in, e.g. case. Needs a conversion factor.',
  },
  {
    key: 'purchaseToStockFactor',
    label: 'Units per purchase unit',
    required: false,
    type: 'number',
    aliases: [
      'factor',
      'conversionfactor',
      'unitspercase',
      'unitsperpurchaseunit',
      'packsize',
      'casepack',
    ],
    hint: 'Stock units per purchase unit, e.g. 12. Fractions allowed.',
  },
];

const STOCK_MOVEMENT_FIELDS: readonly CanonicalFieldSpec[] = [
  {
    key: 'productExternalId',
    label: 'SKU',
    required: true,
    type: 'string',
    isNaturalKey: true,
    rowUnique: false, // a SKU recurs across every movement of that product
    aliases: ['sku', 'item', 'itemnumber', 'productcode', 'product'],
    hint: 'Must match a SKU already in your catalog.',
  },
  {
    key: 'type',
    label: 'Movement',
    required: true,
    type: 'enum',
    enumValues: ['sale', 'receipt', 'transfer_in', 'transfer_out', 'adjustment', 'cycle_count'],
    aliases: ['type', 'movement', 'movementtype', 'transaction'],
  },
  {
    key: 'quantity',
    label: 'Quantity',
    required: true,
    type: 'number',
    aliases: ['quantity', 'qty', 'units', 'amount'],
    hint: 'Sales are negative, receipts positive.',
  },
  {
    key: 'occurredAt',
    label: 'Date',
    required: true,
    type: 'string',
    aliases: ['date', 'occurredat', 'transactiondate', 'when', 'timestamp'],
  },
];

export const KIND_SPECS: Record<ImportableKind, KindSpec> = {
  product: {
    kind: 'product',
    label: 'Products',
    blurb: 'Each row becomes a SKU in your catalog.',
    fields: PRODUCT_FIELDS,
  },
  supplier: {
    kind: 'supplier',
    label: 'Suppliers',
    blurb: 'Each row becomes a supplier with default terms.',
    fields: SUPPLIER_FIELDS,
  },
  product_supplier: {
    kind: 'product_supplier',
    label: 'Supplier pricing',
    blurb: 'Each row links a SKU to a supplier with cost, lead time, and MOQ.',
    fields: PRODUCT_SUPPLIER_FIELDS,
  },
  stock_movement: {
    kind: 'stock_movement',
    label: 'Sales & movements',
    blurb: 'Each row becomes a stock movement forecasting can read.',
    fields: STOCK_MOVEMENT_FIELDS,
  },
};

export function getKindSpec(kind: ImportableKind): KindSpec {
  return KIND_SPECS[kind];
}

export function naturalKeyField(kind: ImportableKind): CanonicalFieldSpec {
  const field = KIND_SPECS[kind].fields.find((f) => f.isNaturalKey);
  if (!field) {
    // Specs above always define exactly one; this guards future edits.
    throw new Error(`No natural-key field defined for kind "${kind}".`);
  }
  return field;
}
