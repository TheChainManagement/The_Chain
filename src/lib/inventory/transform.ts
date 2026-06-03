/**
 * Pure inventory transforms — no IO, no `server-only`, fully unit-testable.
 *
 * queries.ts fetches RLS-scoped rows and hands them here for mapping; actions.ts
 * uses the validation + write-error mapping. Keeping these pure means the
 * aggregation, classification-pick, search-escaping, and error-mapping logic is
 * covered by fast deterministic tests (tests/inventory/transform.test.ts) instead
 * of round-tripping Postgres.
 */

export type ProductStatus = 'active' | 'discontinued';
export type StatusFilter = ProductStatus | 'all';

export interface InventoryListRow {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  unitOfMeasure: string | null;
  onHand: number;
  allocated: number;
  inTransit: number;
  abcClass: string | null;
  xyzClass: string | null;
}

export interface ProductLocationPosition {
  locationId: string;
  locationName: string | null;
  locationType: string | null;
  onHand: number;
  allocated: number;
  inTransit: number;
  available: number;
  lastCountedAt: string | null;
}

export interface ProductSupplierLink {
  supplierId: string;
  supplierName: string | null;
  supplierSku: string | null;
  unitCost: number | null;
  leadTimeDays: number | null;
  moq: number | null;
  isPrimary: boolean;
}

export interface ProductClassification {
  abcClass: string | null;
  xyzClass: string | null;
  annualConsumptionValue: number | null;
  computedAt: string | null;
}

export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unitOfMeasure: string | null;
  status: ProductStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  totals: { onHand: number; allocated: number; inTransit: number; available: number };
  positions: ProductLocationPosition[];
  suppliers: ProductSupplierLink[];
  classification: ProductClassification | null;
  firstStockedAt: string | null;
}

/* ----- raw row shapes returned by the PostgREST selects ----- */

export interface RawLevel {
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
}
export interface RawClass {
  abc_class: string | null;
  xyz_class: string | null;
  location_id: string | null;
}
export interface RawListProduct {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  unit_of_measure: string | null;
  inventory_levels: RawLevel[] | null;
  product_classifications: RawClass[] | null;
}

export interface RawDetailLevel {
  location_id: string;
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
  last_counted_at: string | null;
  locations: { name: string | null; type: string | null } | null;
}
export interface RawDetailSupplier {
  supplier_id: string;
  supplier_sku: string | null;
  unit_cost: number | string | null;
  lead_time_days: number | null;
  moq: number | null;
  is_primary: boolean;
  suppliers: { name: string | null } | null;
}
export interface RawDetailClass {
  abc_class: string | null;
  xyz_class: string | null;
  annual_consumption_value: number | string | null;
  computed_at: string | null;
  location_id: string | null;
}
export interface RawDetailProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string | null;
  status: ProductStatus;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  inventory_levels: RawDetailLevel[] | null;
  product_suppliers: RawDetailSupplier[] | null;
  product_classifications: RawDetailClass[] | null;
}

export const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

/** Tenant-wide classification (location_id null) is canonical; else first. */
export function pickClassification<T extends { location_id: string | null }>(
  rows: T[] | null | undefined,
): T | null {
  const list = rows ?? [];
  return list.find((r) => r.location_id == null) ?? list[0] ?? null;
}

/**
 * Row shape from the `inventory_list_v` aggregate view (Block 3 5k path). The
 * per-SKU sum + tenant-wide classification join is done set-based in SQL; this
 * just coerces the flat row. mapListRow below stays as the documented contract
 * the view implements (and keeps its unit tests meaningful).
 */
export interface RawInventoryViewRow {
  id: string;
  sku: string;
  name: string;
  status: ProductStatus;
  unit_of_measure: string | null;
  on_hand: number | string;
  allocated: number | string;
  in_transit: number | string;
  abc_class: string | null;
  xyz_class: string | null;
}

export function mapViewRow(r: RawInventoryViewRow): InventoryListRow {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    status: r.status,
    unitOfMeasure: r.unit_of_measure,
    onHand: num(r.on_hand),
    allocated: num(r.allocated),
    inTransit: num(r.in_transit),
    abcClass: r.abc_class,
    xyzClass: r.xyz_class,
  };
}

export function mapListRow(p: RawListProduct): InventoryListRow {
  const cls = pickClassification(p.product_classifications);
  const levels = p.inventory_levels ?? [];
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    status: p.status,
    unitOfMeasure: p.unit_of_measure,
    onHand: levels.reduce((s, l) => s + num(l.on_hand), 0),
    allocated: levels.reduce((s, l) => s + num(l.allocated), 0),
    inTransit: levels.reduce((s, l) => s + num(l.in_transit), 0),
    abcClass: cls?.abc_class ?? null,
    xyzClass: cls?.xyz_class ?? null,
  };
}

export function mapProductDetail(data: RawDetailProduct): ProductDetail {
  const positions: ProductLocationPosition[] = (data.inventory_levels ?? []).map((l) => {
    const onHand = num(l.on_hand);
    const allocated = num(l.allocated);
    return {
      locationId: l.location_id,
      locationName: l.locations?.name ?? null,
      locationType: l.locations?.type ?? null,
      onHand,
      allocated,
      inTransit: num(l.in_transit),
      available: onHand - allocated,
      lastCountedAt: l.last_counted_at,
    };
  });

  const totals = positions.reduce(
    (acc, p) => ({
      onHand: acc.onHand + p.onHand,
      allocated: acc.allocated + p.allocated,
      inTransit: acc.inTransit + p.inTransit,
      available: acc.available + p.available,
    }),
    { onHand: 0, allocated: 0, inTransit: 0, available: 0 },
  );

  const suppliers: ProductSupplierLink[] = (data.product_suppliers ?? [])
    .map((s) => ({
      supplierId: s.supplier_id,
      supplierName: s.suppliers?.name ?? null,
      supplierSku: s.supplier_sku,
      unitCost: s.unit_cost == null ? null : num(s.unit_cost),
      leadTimeDays: s.lead_time_days,
      moq: s.moq,
      isPrimary: s.is_primary,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  const clsRow = pickClassification(data.product_classifications);
  const classification: ProductClassification | null = clsRow
    ? {
        abcClass: clsRow.abc_class,
        xyzClass: clsRow.xyz_class,
        annualConsumptionValue:
          clsRow.annual_consumption_value == null ? null : num(clsRow.annual_consumption_value),
        computedAt: clsRow.computed_at,
      }
    : null;

  return {
    id: data.id,
    sku: data.sku,
    name: data.name,
    description: data.description,
    unitOfMeasure: data.unit_of_measure,
    status: data.status,
    attributes: data.attributes ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    totals,
    positions,
    suppliers,
    classification,
    firstStockedAt: null,
  };
}

/**
 * Escape a free-text search term for a PostgREST `or(sku.ilike.*t*,name.ilike.*t*)`
 * filter. Strips every character that carries meaning in PostgREST's filter
 * grammar — comma (clause separator), parens (logic grouping), `*` (wildcard),
 * `%`/`_` (SQL LIKE wildcards), backslash, quotes, colon — so a malicious term
 * cannot inject extra clauses or wildcards. Returns null when nothing usable
 * remains. SKU-friendly chars (letters, digits, space, `-`, `/`, `.`, `#`) pass.
 */
export function sanitizeSearch(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 \-/.#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Normalize an arbitrary status query param to a known filter. */
export function normalizeStatusFilter(raw: string | null | undefined): StatusFilter {
  if (raw === 'discontinued' || raw === 'all') {
    return raw;
  }
  return 'active';
}

export interface ProductInput {
  sku?: string;
  name?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Shared create/update validation (pure). */
export function validateProductInput(input: ProductInput, requireSku: boolean): ValidationResult {
  if (requireSku && !input.sku?.trim()) {
    return { ok: false, error: 'SKU is required.' };
  }
  if (!input.name?.trim()) {
    return { ok: false, error: 'Product name is required.' };
  }
  return { ok: true };
}

export const PERMISSION_MESSAGE =
  'You do not have permission to change the catalog. Ask an owner or manager.';

/** Map a Postgres/PostgREST write error to a human message. */
export function mapWriteError(code: string | undefined, message: string): string {
  if (code === '23505') {
    return 'A product with that SKU already exists in your catalog.';
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return PERMISSION_MESSAGE;
  }
  return 'Could not save the product. Please try again.';
}
