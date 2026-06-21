import { describe, expect, it } from 'vitest';
import { getKindSpec } from '@/lib/import/field-specs';
import { autoMap } from '@/lib/import/mapping';
import { parseCsv } from '@/lib/import/parse';
import { mapRows } from '@/lib/import/transform';

/**
 * Pure transform coverage for the Wave 5.2 kinds (supplier, stock_movement) —
 * the case-folded natural-key de-dup and the movement field coercion, with no
 * DB. The authenticated write path is covered by commit-writers.test.ts.
 */

function map(kind: 'supplier' | 'stock_movement', csv: string) {
  const spec = getKindSpec(kind);
  const parsed = parseCsv(csv);
  return mapRows(parsed.rows, spec, autoMap(parsed.headers, spec));
}

describe('mapRows — supplier (case-folded natural key)', () => {
  it('folds case for the in-file dedup so "Acme"/"acme" collide', () => {
    const res = map('supplier', 'Name,Lead Time\nAcme,5\nacme,9\nBeta,3\n');
    expect(res.payloads).toHaveLength(2); // Acme (first wins) + Beta
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.code).toBe('duplicate_key');
    expect(res.payloads.map((p) => p.externalId)).toEqual(['Acme', 'Beta']);
  });

  it('coerces lead time / min order and defaults a blank status to active', () => {
    const res = map('supplier', 'Name,Lead Time,Min Order,Status\nAtlas,7,500,\n');
    expect(res.errors).toHaveLength(0);
    const a = res.payloads[0]?.attributes as {
      defaultLeadTimeDays: number;
      minOrderValue: number;
      status: string;
    };
    expect(a.defaultLeadTimeDays).toBe(7);
    expect(a.minOrderValue).toBe(500);
    expect(a.status).toBe('active');
  });
});

describe('mapRows — stock_movement', () => {
  it('does not dedup rows on the recurring SKU (a product sells many times)', () => {
    const res = map(
      'stock_movement',
      'SKU,Movement,Quantity,Date\nMOV-1,sale,-5,2026-03-15\nMOV-1,sale,-2,2026-03-16\n',
    );
    expect(res.payloads).toHaveLength(2); // same SKU, both rows survive
    expect(res.errors).toHaveLength(0);
  });

  it('coerces a signed quantity and flags a missing required field', () => {
    const res = map(
      'stock_movement',
      'SKU,Movement,Quantity,Date\nMOV-1,sale,-5,2026-03-15\nMOV-2,receipt,,2026-03-16\n',
    );
    expect(res.payloads).toHaveLength(1);
    const a = res.payloads[0]?.attributes as { quantity: number; type: string };
    expect(a.quantity).toBe(-5);
    expect(a.type).toBe('sale');
    expect(res.errors[0]?.code).toBe('missing_required');
  });
});
