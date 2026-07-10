import { describe, expect, it } from 'vitest';
import {
  buildReliabilityRibbon,
  formatOpenPoError,
  formatPurchaseFactor,
  mapSupplierDetail,
  mapSupplierListRow,
  mapSupplierWriteError,
  otifPercent,
  otifTone,
  PERMISSION_MESSAGE,
  type RawSupplierDetail,
  type RawSupplierListRow,
  RELIABILITY_TILES,
  tileState,
  validateLinkInput,
  validateSupplierInput,
} from '@/lib/suppliers/transform';

/**
 * Block 4 pure-logic coverage. RLS / tenant fencing for suppliers +
 * product_suppliers is proven by tests/foundation/rls-cross-tenant.test.ts; these
 * own OTIF tone, the reliability ribbon, supplier mapping, validation, and the
 * archive-guard message.
 */

describe('otifTone — semantic, never cobalt', () => {
  it('reads flow at/above 95%, warn at/above 85%, stop below', () => {
    expect(otifTone(0.97)).toBe('flow');
    expect(otifTone(0.9)).toBe('warn');
    expect(otifTone(0.6)).toBe('stop');
  });
  it('is deep (neutral) when there is no OTIF yet', () => {
    expect(otifTone(null)).toBe('deep');
  });
});

describe('otifPercent', () => {
  it('converts a 0..1 fraction to a one-decimal percent', () => {
    expect(otifPercent(0.952)).toBe(95.2);
  });
  it('passes null through', () => {
    expect(otifPercent(null)).toBeNull();
  });
});

describe('tileState — delivery classification', () => {
  it('on-time-in-full is otif', () => {
    expect(tileState({ on_time: true, in_full: true, on_time_in_full: true })).toBe('otif');
  });
  it('short (not in full) is amber', () => {
    expect(tileState({ on_time: true, in_full: false, on_time_in_full: false })).toBe('short');
  });
  it('late (not on time, but in full) is red', () => {
    expect(tileState({ on_time: false, in_full: true, on_time_in_full: false })).toBe('late');
  });
});

describe('buildReliabilityRibbon', () => {
  it('always returns a fixed-width ribbon, padded with pending', () => {
    const tiles = buildReliabilityRibbon([]);
    expect(tiles).toHaveLength(RELIABILITY_TILES);
    expect(tiles.every((t) => t.state === 'pending')).toBe(true);
  });

  it('maps the most recent deliveries and pads the rest', () => {
    const tiles = buildReliabilityRibbon([
      {
        on_time: true,
        in_full: true,
        on_time_in_full: true,
        actual_delivery_at: '2026-06-01',
        recorded_at: '2026-06-01',
        po_id: 'po1',
      },
    ]);
    expect(tiles[0]?.state).toBe('otif');
    expect(tiles[0]?.poRef).toBe('po1');
    expect(tiles.slice(1).every((t) => t.state === 'pending')).toBe(true);
  });

  it('caps at RELIABILITY_TILES even with more history', () => {
    const many = Array.from({ length: 12 }, () => ({
      on_time: true,
      in_full: true,
      on_time_in_full: true,
      actual_delivery_at: '2026-06-01',
      recorded_at: '2026-06-01',
      po_id: 'po',
    }));
    expect(buildReliabilityRibbon(many)).toHaveLength(RELIABILITY_TILES);
  });
});

describe('mapSupplierListRow', () => {
  const base: RawSupplierListRow = {
    id: 's1',
    name: 'Atchafalaya Distributing',
    status: 'active',
    default_lead_time_days: 14,
    min_order_value: '500.00',
    product_suppliers: [{ count: 7 }],
    supplier_scorecards: [],
  };

  it('reads the linked-product count from the embedded aggregate', () => {
    expect(mapSupplierListRow(base).productCount).toBe(7);
  });

  it('is zero products + null OTIF for a fresh supplier', () => {
    const row = mapSupplierListRow({ ...base, product_suppliers: null, supplier_scorecards: null });
    expect(row.productCount).toBe(0);
    expect(row.otifPct).toBeNull();
  });

  it('prefers the rolling_30d scorecard for OTIF', () => {
    const row = mapSupplierListRow({
      ...base,
      supplier_scorecards: [
        {
          window_kind: 'rolling_90d',
          otif_pct: '0.80',
          on_time_pct: '0.82',
          in_full_pct: '0.9',
          lead_time_avg_days: null,
          lead_time_stddev_days: null,
          sample_size: 9,
        },
        {
          window_kind: 'rolling_30d',
          otif_pct: '0.95',
          on_time_pct: '0.96',
          in_full_pct: '0.98',
          lead_time_avg_days: null,
          lead_time_stddev_days: null,
          sample_size: 4,
        },
      ],
    });
    expect(row.otifPct).toBeCloseTo(0.95);
  });
});

describe('mapSupplierDetail', () => {
  const base: RawSupplierDetail = {
    id: 's1',
    name: 'Riverbend Hardware',
    status: 'active',
    contact: { email: 'orders@riverbend.test' },
    default_lead_time_days: 10,
    min_order_value: null,
    qbo_vendor_id: null,
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-06-02T00:00:00Z',
    product_suppliers: [
      {
        product_id: 'p2',
        unit_cost: '2.00',
        lead_time_days: 9,
        moq: 5,
        is_primary: false,
        products: { sku: 'B', name: 'Beta' },
      },
      {
        product_id: 'p1',
        unit_cost: '1.00',
        lead_time_days: 7,
        moq: 1,
        is_primary: true,
        products: { sku: 'A', name: 'Alpha' },
      },
    ],
    supplier_performance: [],
    supplier_scorecards: [],
  };

  it('sorts linked products with the primary first', () => {
    expect(mapSupplierDetail(base).products[0]?.isPrimary).toBe(true);
  });

  it('always builds the full reliability ribbon (pending when no history)', () => {
    expect(mapSupplierDetail(base).reliability).toHaveLength(RELIABILITY_TILES);
  });

  it('defaults contact to an empty object when null', () => {
    expect(mapSupplierDetail({ ...base, contact: null }).contact).toEqual({});
  });
});

describe('validateSupplierInput', () => {
  it('requires a name', () => {
    expect(validateSupplierInput({ name: '  ' }).ok).toBe(false);
  });
  it('rejects a non-integer lead time', () => {
    expect(validateSupplierInput({ name: 'X', defaultLeadTimeDays: '7.5' }).ok).toBe(false);
  });
  it('accepts a blank lead time', () => {
    expect(validateSupplierInput({ name: 'X', defaultLeadTimeDays: '' })).toEqual({ ok: true });
  });
});

describe('validateLinkInput', () => {
  it('requires a supplier', () => {
    expect(validateLinkInput({ supplierId: '' }).ok).toBe(false);
  });
  it('rejects a non-numeric cost', () => {
    expect(validateLinkInput({ supplierId: 's', unitCost: 'abc' }).ok).toBe(false);
  });
  it('accepts numeric terms', () => {
    expect(
      validateLinkInput({ supplierId: 's', unitCost: '1.25', leadTimeDays: '7', moq: '1' }),
    ).toEqual({ ok: true });
  });
  it('rejects a conversion factor without a purchase unit', () => {
    const res = validateLinkInput({ supplierId: 's', purchaseToStockFactor: '12' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/both.*or neither/i);
  });
  it('rejects a purchase unit without a conversion factor', () => {
    const res = validateLinkInput({ supplierId: 's', purchaseUom: 'case' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/both.*or neither/i);
  });
  it('accepts a fractional conversion factor', () => {
    expect(
      validateLinkInput({ supplierId: 's', purchaseUom: 'kg', purchaseToStockFactor: '0.5' }),
    ).toEqual({ ok: true });
  });
  it('rejects a zero conversion factor', () => {
    expect(
      validateLinkInput({ supplierId: 's', purchaseUom: 'case', purchaseToStockFactor: '0' }).ok,
    ).toBe(false);
  });
  it('rejects a negative conversion factor', () => {
    expect(
      validateLinkInput({ supplierId: 's', purchaseUom: 'case', purchaseToStockFactor: '-3' }).ok,
    ).toBe(false);
  });
  it('rejects a non-numeric conversion factor', () => {
    expect(
      validateLinkInput({ supplierId: 's', purchaseUom: 'case', purchaseToStockFactor: 'abc' }).ok,
    ).toBe(false);
  });
  it('accepts both purchase fields blank', () => {
    expect(
      validateLinkInput({ supplierId: 's', purchaseUom: '', purchaseToStockFactor: '' }),
    ).toEqual({ ok: true });
  });
});

describe('formatPurchaseFactor', () => {
  it('trims trailing zeros from a numeric(14,4) factor', () => {
    expect(formatPurchaseFactor(12)).toBe('12');
    expect(formatPurchaseFactor(Number('12.0000'))).toBe('12');
  });
  it('keeps a fractional factor intact', () => {
    expect(formatPurchaseFactor(0.5)).toBe('0.5');
    expect(formatPurchaseFactor(2.25)).toBe('2.25');
  });
});

describe('mapSupplierWriteError', () => {
  it('maps a duplicate link to a friendly message', () => {
    expect(mapSupplierWriteError('23505', '')).toMatch(/already linked/i);
  });
  it('maps RLS rejection to the permission message', () => {
    expect(mapSupplierWriteError('42501', '')).toBe(PERMISSION_MESSAGE);
  });
});

describe('formatOpenPoError', () => {
  it('names the open POs and truncates past five', () => {
    const msg = formatOpenPoError(['PO-1', 'PO-2', 'PO-3', 'PO-4', 'PO-5', 'PO-6']);
    expect(msg).toContain('PO-1');
    expect(msg).toContain('and 1 more');
  });
});
