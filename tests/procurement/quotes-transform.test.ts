import { describe, expect, it } from 'vitest';
import {
  buildQuoteRow,
  canEnterQuotes,
  computeAward,
  perStockUnitCost,
  type VendorQuoteCell,
  validateQuoteInput,
} from '@/lib/procurement/transform';

describe('canEnterQuotes', () => {
  it('opens for sent and quoted only', () => {
    expect(canEnterQuotes('sent').ok).toBe(true);
    expect(canEnterQuotes('quoted').ok).toBe(true);
    for (const s of ['draft', 'closed', 'canceled'] as const) {
      expect(canEnterQuotes(s).ok).toBe(false);
    }
  });
});

describe('validateQuoteInput', () => {
  const base = { cost: '24', purchaseUom: '', factor: '', leadTimeDays: '', moq: '' };

  it('accepts a bare unit price (same-unit quote)', () => {
    const r = validateQuoteInput(base);
    expect(r.ok && r.quote).toEqual({
      cost: 24,
      purchaseUom: null,
      factor: null,
      leadTimeDays: null,
      moq: null,
    });
  });

  it('accepts a case quote with fractional-capable factor', () => {
    const r = validateQuoteInput({ ...base, purchaseUom: 'CS', factor: '12' });
    expect(r.ok && r.quote.factor).toBe(12);
  });

  it('requires the factor when a purchase unit is named', () => {
    const r = validateQuoteInput({ ...base, purchaseUom: 'CS' });
    expect(r.ok).toBe(false);
  });

  it('requires a purchase unit when a factor is entered', () => {
    const r = validateQuoteInput({ ...base, factor: '12' });
    expect(r.ok).toBe(false);
  });

  it('rejects negative cost, non-positive factor, fractional lead/moq', () => {
    expect(validateQuoteInput({ ...base, cost: '-1' }).ok).toBe(false);
    expect(validateQuoteInput({ ...base, purchaseUom: 'CS', factor: '0' }).ok).toBe(false);
    expect(validateQuoteInput({ ...base, leadTimeDays: '2.5' }).ok).toBe(false);
    expect(validateQuoteInput({ ...base, moq: '-3' }).ok).toBe(false);
  });
});

describe('perStockUnitCost + buildQuoteRow', () => {
  it('normalizes purchase-unit quotes for comparison', () => {
    expect(perStockUnitCost(24, 12)).toBe(2);
    expect(perStockUnitCost(24, null)).toBe(24);
  });

  it('flags the cheapest per-stock-unit cell, not the lowest sticker price', () => {
    // Vendor A: $24/case of 12 = $2/ea. Vendor B: $3/ea. A's sticker is higher
    // but A is cheaper where it counts.
    const row = buildQuoteRow([
      {
        supplierId: 'a',
        quotedUnitCost: 24,
        purchaseUom: 'CS',
        factor: 12,
        leadTimeDays: null,
        moq: null,
      },
      {
        supplierId: 'b',
        quotedUnitCost: 3,
        purchaseUom: null,
        factor: null,
        leadTimeDays: null,
        moq: null,
      },
    ]);
    expect(row.find((c) => c.supplierId === 'a')?.cheapest).toBe(true);
    expect(row.find((c) => c.supplierId === 'b')?.cheapest).toBe(false);
  });

  it('lights every cell on a tie (the operator breaks it)', () => {
    const row = buildQuoteRow([
      {
        supplierId: 'a',
        quotedUnitCost: 2,
        purchaseUom: null,
        factor: null,
        leadTimeDays: null,
        moq: null,
      },
      {
        supplierId: 'b',
        quotedUnitCost: 24,
        purchaseUom: 'CS',
        factor: 12,
        leadTimeDays: null,
        moq: null,
      },
    ]);
    expect(row.every((c) => c.cheapest)).toBe(true);
  });
});

describe('computeAward', () => {
  const lines = [
    { lineNo: 1, productId: 'p1', qty: 48 },
    { lineNo: 2, productId: 'p2', qty: 10 },
  ];
  const cell = (supplierId: string, cost: number, factor: number | null): VendorQuoteCell => ({
    supplierId,
    quotedUnitCost: cost,
    purchaseUom: factor ? 'CS' : null,
    factor,
    leadTimeDays: null,
    moq: null,
    perStockUnit: cost / (factor ?? 1),
    cheapest: false,
  });
  const quotes = new Map([
    [1, [cell('a', 24, 12), cell('b', 3, null)]],
    [2, [cell('b', 5, null)]],
  ]);

  it('converts stock qty into the winning vendor purchase unit (fractional allowed)', () => {
    const r = computeAward(lines, quotes, [
      { lineNo: 1, supplierId: 'a' },
      { lineNo: 2, supplierId: 'b' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.lines[0]).toMatchObject({ qty: 4, unitCost: 24, purchaseUom: 'CS', factor: 12 });
    expect(r.lines[1]).toMatchObject({ qty: 10, unitCost: 5 });
    expect(r.total).toBe(4 * 24 + 10 * 5);
  });

  it('honors the quoted MOQ when it exceeds converted demand', () => {
    const moqQuotes = new Map([[1, [{ ...cell('a', 20, 12), moq: 5 }]]]);
    const r = computeAward([{ lineNo: 1, productId: 'p1', qty: 24 }], moqQuotes, [
      { lineNo: 1, supplierId: 'a' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.lines[0]).toMatchObject({ qty: 5, unitCost: 20, purchaseUom: 'CS', factor: 12 });
    expect(r.total).toBe(100);
  });

  it('rejects an empty pick set and picks without quotes', () => {
    expect(computeAward(lines, quotes, []).ok).toBe(false);
    expect(computeAward(lines, quotes, [{ lineNo: 2, supplierId: 'a' }]).ok).toBe(false);
    expect(computeAward(lines, quotes, [{ lineNo: 9, supplierId: 'a' }]).ok).toBe(false);
  });

  it('supports a mixed-vendor award (fans out to N POs at conversion)', () => {
    const r = computeAward(lines, quotes, [
      { lineNo: 1, supplierId: 'b' },
      { lineNo: 2, supplierId: 'b' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(new Set(r.lines.map((l) => l.supplierId)).size).toBe(1);
    expect(r.total).toBe(48 * 3 + 10 * 5);
  });
});
