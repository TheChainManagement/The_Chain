/**
 * Canonical payload schemas — one per EntityKind.
 *
 * Every adapter (QBO native, Rutter aggregator, CSV, future distribution-ERP
 * natives) reads from its source and produces these shapes. Downstream code
 * (workflow steps, dashboard reads, forecasting) only sees the canonical
 * model. The seam is the build-to-sell acquisition asset.
 *
 * Schema versioning: `CANONICAL_SCHEMA_VERSION` is incremented whenever a
 * canonical attribute set changes shape. Adapters MUST stamp the version on
 * every CanonicalPayload they produce so downstream code can migrate forward.
 */

import { z } from 'zod';

export const CANONICAL_SCHEMA_VERSION = 1;

// ----- Product -----
export const productAttributes = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  unitOfMeasure: z.string().optional(),
  status: z.enum(['active', 'discontinued']),
  primarySupplierExternalId: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type ProductAttributes = z.infer<typeof productAttributes>;

// ----- Supplier -----
export const supplierAttributes = z.object({
  name: z.string().min(1),
  contact: z.record(z.string(), z.unknown()).default({}),
  defaultLeadTimeDays: z.number().int().nonnegative().optional(),
  minOrderValue: z.number().nonnegative().optional(),
  status: z.enum(['active', 'archived']),
});
export type SupplierAttributes = z.infer<typeof supplierAttributes>;

// ----- Product ↔ Supplier link -----
export const productSupplierAttributes = z.object({
  productExternalId: z.string().min(1),
  supplierExternalId: z.string().min(1),
  supplierSku: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  moq: z.number().int().nonnegative().optional(),
  isPrimary: z.boolean().default(false),
});
export type ProductSupplierAttributes = z.infer<typeof productSupplierAttributes>;

// ----- Purchase order -----
const purchaseOrderLine = z.object({
  lineNo: z.number().int().positive(),
  productExternalId: z.string().min(1),
  orderedQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative().optional(),
  unitCost: z.number().nonnegative().optional(),
});

export const purchaseOrderAttributes = z.object({
  supplierExternalId: z.string().min(1),
  locationExternalId: z.string().optional(),
  status: z.enum([
    'draft',
    'recommended',
    'approved',
    'exported',
    'sent',
    'partial_received',
    'received',
    'closed',
    'canceled',
  ]),
  total: z.number().nonnegative().optional(),
  expectedDeliveryAt: z.string().optional(), // ISO; loosened from .datetime for QBO date-only fields
  actualDeliveryAt: z.string().optional(),
  lines: z.array(purchaseOrderLine).min(1),
});
export type PurchaseOrderAttributes = z.infer<typeof purchaseOrderAttributes>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLine>;

// ----- Inventory level -----
export const inventoryLevelAttributes = z.object({
  productExternalId: z.string().min(1),
  locationExternalId: z.string().optional(),
  onHand: z.number(),
  allocated: z.number().optional(),
  inTransit: z.number().optional(),
  lastCountedAt: z.string().optional(),
});
export type InventoryLevelAttributes = z.infer<typeof inventoryLevelAttributes>;

// ----- Stock movement -----
export const stockMovementAttributes = z.object({
  productExternalId: z.string().min(1),
  locationExternalId: z.string().optional(),
  type: z.enum(['sale', 'receipt', 'transfer_in', 'transfer_out', 'adjustment', 'cycle_count']),
  quantity: z.number(),
  occurredAt: z.string(), // ISO; preserved from the source as-is
  sourceRef: z.string().optional(),
});
export type StockMovementAttributes = z.infer<typeof stockMovementAttributes>;

// ----- Schema registry (used by validators to look up by EntityKind) -----
export const canonicalSchemasByKind = {
  product: productAttributes,
  supplier: supplierAttributes,
  product_supplier: productSupplierAttributes,
  purchase_order: purchaseOrderAttributes,
  inventory_level: inventoryLevelAttributes,
  stock_movement: stockMovementAttributes,
} as const;
