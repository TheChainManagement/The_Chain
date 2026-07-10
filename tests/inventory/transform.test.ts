import { describe, expect, it } from 'vitest';
import {
  mapListRow,
  mapProductDetail,
  mapWriteError,
  normalizeStatusFilter,
  PERMISSION_MESSAGE,
  pickClassification,
  type RawDetailProduct,
  type RawListProduct,
  sanitizeSearch,
  validateProductInput,
} from '@/lib/inventory/transform';

/**
 * Block 3 pure-logic coverage. The RLS / tenant fencing is proven by
 * tests/foundation/rls-cross-tenant.test.ts; these tests own the row→model
 * aggregation, classification selection, search escaping, validation, and
 * write-error mapping that the catalog UI depends on.
 */

const listRow = (over: Partial<RawListProduct> = {}): RawListProduct => ({
  id: 'p1',
  sku: 'SKU-1',
  name: 'Widget',
  status: 'active',
  unit_of_measure: 'each',
  inventory_levels: [],
  product_classifications: [],
  ...over,
});

describe('mapListRow — on-hand aggregation', () => {
  it('sums on_hand / allocated / in_transit across every location', () => {
    const row = mapListRow(
      listRow({
        inventory_levels: [
          { on_hand: 100, allocated: 10, in_transit: 5 },
          { on_hand: 40, allocated: 4, in_transit: 1 },
        ],
      }),
    );
    expect(row.onHand).toBe(140);
    expect(row.allocated).toBe(14);
    expect(row.inTransit).toBe(6);
  });

  it('coerces numeric-as-string from PostgREST without NaN', () => {
    const row = mapListRow(
      listRow({ inventory_levels: [{ on_hand: '1247.20', allocated: '0', in_transit: '0' }] }),
    );
    expect(row.onHand).toBeCloseTo(1247.2);
  });

  it('treats a SKU with no inventory rows as zero on-hand', () => {
    expect(mapListRow(listRow({ inventory_levels: null })).onHand).toBe(0);
  });
});

describe('pickClassification — tenant-wide wins', () => {
  it('prefers the tenant-wide (location_id null) row over per-location rows', () => {
    const picked = pickClassification([
      { location_id: 'loc-1', abc_class: 'C' },
      { location_id: null, abc_class: 'A' },
    ]);
    expect(picked?.abc_class).toBe('A');
  });

  it('falls back to the first row when none are tenant-wide', () => {
    expect(pickClassification([{ location_id: 'loc-1', abc_class: 'B' }])?.abc_class).toBe('B');
  });

  it('returns null for no rows', () => {
    expect(pickClassification([])).toBeNull();
    expect(pickClassification(null)).toBeNull();
  });
});

const detailRow = (over: Partial<RawDetailProduct> = {}): RawDetailProduct => ({
  id: 'p1',
  sku: 'SKU-1',
  name: 'Widget',
  description: null,
  unit_of_measure: 'each',
  status: 'active',
  attributes: null,
  created_at: '2026-06-02T16:00:00Z',
  updated_at: '2026-06-02T16:00:00Z',
  inventory_levels: [],
  product_suppliers: [],
  product_classifications: [],
  ...over,
});

describe('mapProductDetail', () => {
  it('computes available = on_hand - allocated per location and totals across', () => {
    const d = mapProductDetail(
      detailRow({
        inventory_levels: [
          {
            location_id: 'l1',
            on_hand: 100,
            allocated: 30,
            in_transit: 0,
            last_counted_at: null,
            locations: { name: 'Main DC', type: 'warehouse' },
          },
          {
            location_id: 'l2',
            on_hand: 20,
            allocated: 5,
            in_transit: 0,
            last_counted_at: null,
            locations: { name: 'Store 2', type: 'store' },
          },
        ],
      }),
    );
    expect(d.positions[0]?.available).toBe(70);
    expect(d.totals.onHand).toBe(120);
    expect(d.totals.available).toBe(85);
  });

  it('sorts suppliers with the primary first', () => {
    const d = mapProductDetail(
      detailRow({
        product_suppliers: [
          {
            supplier_id: 's2',
            supplier_sku: null,
            unit_cost: 2,
            lead_time_days: 7,
            moq: 1,
            is_primary: false,
            purchase_uom: null,
            purchase_to_stock_factor: null,
            suppliers: { name: 'Alt' },
          },
          {
            supplier_id: 's1',
            supplier_sku: null,
            unit_cost: 1,
            lead_time_days: 5,
            moq: 1,
            is_primary: true,
            purchase_uom: 'case',
            purchase_to_stock_factor: '12.0000',
            suppliers: { name: 'Primary' },
          },
        ],
      }),
    );
    expect(d.suppliers[0]?.isPrimary).toBe(true);
    expect(d.suppliers[0]?.supplierName).toBe('Primary');
    // W2-2.5: the purchase-unit conversion rides the link (numeric arrives as text).
    expect(d.suppliers[0]?.purchaseUom).toBe('case');
    expect(d.suppliers[0]?.purchaseToStockFactor).toBe(12);
    expect(d.suppliers[1]?.purchaseUom).toBeNull();
  });

  it('defaults attributes to an empty object', () => {
    expect(mapProductDetail(detailRow()).attributes).toEqual({});
  });
});

describe('sanitizeSearch — injection + wildcard safe', () => {
  it('keeps SKU-friendly characters', () => {
    expect(sanitizeSearch('3/4 in. elbow-A#2')).toBe('3/4 in. elbow-A#2');
  });

  it('strips PostgREST filter metacharacters', () => {
    // commas, parens, *, %, _, quotes, backslash, colon must not survive.
    expect(sanitizeSearch('a,b)c(*%_:"\\d')).toBe('a b c d');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(sanitizeSearch('')).toBeNull();
    expect(sanitizeSearch('   ')).toBeNull();
    expect(sanitizeSearch(null)).toBeNull();
  });
});

describe('normalizeStatusFilter', () => {
  it('defaults unknown/absent to active', () => {
    expect(normalizeStatusFilter(undefined)).toBe('active');
    expect(normalizeStatusFilter('bogus')).toBe('active');
  });
  it('passes through discontinued and all', () => {
    expect(normalizeStatusFilter('discontinued')).toBe('discontinued');
    expect(normalizeStatusFilter('all')).toBe('all');
  });
});

describe('validateProductInput', () => {
  it('requires SKU on create', () => {
    expect(validateProductInput({ sku: '', name: 'x' }, true)).toEqual({
      ok: false,
      error: 'SKU is required.',
    });
  });
  it('does not require SKU on update', () => {
    expect(validateProductInput({ name: 'x' }, false)).toEqual({ ok: true });
  });
  it('always requires a name', () => {
    expect(validateProductInput({ sku: 'S', name: '  ' }, true).ok).toBe(false);
  });
});

describe('mapWriteError', () => {
  it('maps unique violation to a duplicate-SKU message', () => {
    expect(mapWriteError('23505', 'dup')).toMatch(/already exists/i);
  });
  it('maps RLS rejection (code or text) to the permission message', () => {
    expect(mapWriteError('42501', '')).toBe(PERMISSION_MESSAGE);
    expect(mapWriteError(undefined, 'new row violates row-level security policy')).toBe(
      PERMISSION_MESSAGE,
    );
  });
  it('falls back to a generic message otherwise', () => {
    expect(mapWriteError('XXXXX', 'weird')).toMatch(/try again/i);
  });
});
