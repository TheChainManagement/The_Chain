import { describe, expect, it } from 'vitest';
import {
  buildRfqChain,
  canCancel,
  canClose,
  canEditDocument,
  canSend,
  mapRfqWriteError,
  PERMISSION_MESSAGE,
  rfqToVendorCsv,
  validateLineQty,
  validateRfqInput,
} from '@/lib/procurement/transform';

describe('validateRfqInput', () => {
  it('requires a title and a location', () => {
    expect(validateRfqInput({ title: '', locationId: 'x' }).ok).toBe(false);
    expect(validateRfqInput({ title: '  ', locationId: 'x' }).ok).toBe(false);
    expect(validateRfqInput({ title: 'Q3 fasteners', locationId: '' }).ok).toBe(false);
    expect(validateRfqInput({ title: 'Q3 fasteners', locationId: 'x' }).ok).toBe(true);
  });

  it('caps the title length', () => {
    expect(validateRfqInput({ title: 'x'.repeat(121), locationId: 'x' }).ok).toBe(false);
    expect(validateRfqInput({ title: 'x'.repeat(120), locationId: 'x' }).ok).toBe(true);
  });
});

describe('validateLineQty', () => {
  it('accepts positive decimals (fractional stock is allowed)', () => {
    expect(validateLineQty('2.5')).toEqual({ ok: true, qty: 2.5 });
  });
  it('rejects zero, negatives, and junk', () => {
    expect(validateLineQty('0').ok).toBe(false);
    expect(validateLineQty('-3').ok).toBe(false);
    expect(validateLineQty('').ok).toBe(false);
    expect(validateLineQty('twelve').ok).toBe(false);
  });
});

describe('status transitions (design §5)', () => {
  it('send needs draft + at least one line + one vendor', () => {
    expect(canSend('draft', 1, 1).ok).toBe(true);
    expect(canSend('draft', 0, 1).ok).toBe(false);
    expect(canSend('draft', 1, 0).ok).toBe(false);
    expect(canSend('sent', 1, 1).ok).toBe(false);
    expect(canSend('closed', 1, 1).ok).toBe(false);
  });

  it('close is for sent/quoted only', () => {
    expect(canClose('sent').ok).toBe(true);
    expect(canClose('quoted').ok).toBe(true);
    expect(canClose('draft').ok).toBe(false);
    expect(canClose('canceled').ok).toBe(false);
  });

  it('cancel is for draft/sent only', () => {
    expect(canCancel('draft').ok).toBe(true);
    expect(canCancel('sent').ok).toBe(true);
    expect(canCancel('closed').ok).toBe(false);
  });

  it('the document only edits as a draft', () => {
    expect(canEditDocument('draft').ok).toBe(true);
    for (const s of ['sent', 'quoted', 'closed', 'canceled'] as const) {
      expect(canEditDocument(s).ok).toBe(false);
    }
  });
});

describe('buildRfqChain', () => {
  it('lights reached nodes in order', () => {
    expect(buildRfqChain('draft').map((s) => s.state)).toEqual([
      'done',
      'pending',
      'pending',
      'pending',
    ]);
    expect(buildRfqChain('sent').map((s) => s.state)).toEqual([
      'done',
      'done',
      'pending',
      'pending',
    ]);
    expect(buildRfqChain('closed').every((s) => s.state === 'done')).toBe(true);
  });

  it('canceled shows a stop node where the document died, nothing pretends progress', () => {
    const chain = buildRfqChain('canceled');
    expect(chain.map((s) => s.state)).toEqual(['done', 'stopped', 'pending', 'pending']);
  });
});

describe('rfqToVendorCsv', () => {
  const header = {
    title: 'Q3 fasteners',
    vendorName: 'Acme Supply',
    locationName: 'Main DC',
    respondBy: '2026-07-20',
  };
  const line = {
    lineNo: 1,
    sku: 'BLT-M12-50',
    productName: 'Hex bolt M12x50',
    qty: 48,
    stockUom: 'each',
    note: null,
  };

  it('writes the vendor-readable header block then the line table', () => {
    const csv = rfqToVendorCsv(header, [line]);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('Request for quote,Q3 fasteners');
    expect(rows[1]).toBe('Vendor,Acme Supply');
    expect(rows[3]).toBe('Respond by,2026-07-20');
    expect(rows[5]).toContain('your unit price');
    expect(rows[6]).toBe('1,BLT-M12-50,Hex bolt M12x50,48,each,,,');
  });

  it('escapes quotes/commas and guards formula injection', () => {
    const csv = rfqToVendorCsv({ ...header, title: 'Fast, "cheap"' }, [
      { ...line, sku: '=HYPERLINK("evil")', note: 'a,b' },
    ]);
    expect(csv).toContain('"Fast, ""cheap"""');
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(csv).toContain('"a,b"');
  });

  it('reads politely when no respond-by is set', () => {
    const csv = rfqToVendorCsv({ ...header, respondBy: null }, [line]);
    expect(csv).toContain('Respond by,at your earliest convenience');
  });
});

describe('mapRfqWriteError', () => {
  it('maps RLS to the permission message', () => {
    expect(mapRfqWriteError('42501', '')).toBe(PERMISSION_MESSAGE);
    expect(mapRfqWriteError(undefined, 'new row violates row-level security')).toBe(
      PERMISSION_MESSAGE,
    );
  });
  it('maps duplicates, missing FKs, and CHECKs to operator language', () => {
    expect(mapRfqWriteError('23505', '')).toContain('already on this quote request');
    expect(mapRfqWriteError('23503', '')).toContain('no longer exists');
    expect(mapRfqWriteError('23514', '')).toContain('greater than zero');
  });
});
