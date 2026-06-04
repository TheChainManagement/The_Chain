import { describe, expect, it } from 'vitest';
import { CsvSourceAdapter } from '@/lib/import/csv-adapter';
import { getKindSpec } from '@/lib/import/field-specs';
import { autoMap } from '@/lib/import/mapping';
import { parseCsv } from '@/lib/import/parse';
import { FatalError, type SourceAdapter } from '@/lib/source-adapter';

const productSpec = getKindSpec('product');

function adapterFor(csvText: string): CsvSourceAdapter {
  // Mirror the real flow: headers come from the parser (BOM already stripped),
  // and the mapping is auto-derived from those headers.
  const { headers } = parseCsv(csvText);
  return new CsvSourceAdapter({ product: { csvText, mapping: autoMap(headers, productSpec) } });
}

describe('CsvSourceAdapter conforms to SourceAdapter', () => {
  it('is assignable to the SourceAdapter interface', () => {
    // Compile-time conformance (the acceptance "compiles against the interface").
    const adapter: SourceAdapter = new CsvSourceAdapter({});
    expect(adapter.source).toBe('csv');
  });

  it('advertises read-only CSV capabilities', () => {
    const { capabilities } = new CsvSourceAdapter({});
    expect(capabilities).toMatchObject({
      readProducts: true,
      readSuppliers: true,
      readStockMovements: true,
      writePurchaseOrders: false,
      webhooks: false,
    });
  });
});

describe('pull', () => {
  it('returns canonical product payloads from a mapped CSV', async () => {
    const csv = 'SKU,Name,Status\nAB-1,Widget,active\nAB-2,Gadget,discontinued\n';
    const result = await adapterFor(csv).pull('product', null, 'key-1');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ kind: 'product', externalId: 'AB-1' });
    expect(result.errors).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('puts bad rows in errors (keyed by row number) without dropping the file', async () => {
    const csv = 'SKU,Name\nAB-1,Widget\n,Missing SKU\nAB-3,Gamma\n';
    const result = await adapterFor(csv).pull('product', null, 'key-2');
    expect(result.items.map((i) => i.externalId)).toEqual(['AB-1', 'AB-3']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.externalId).toBe('2'); // CSV data row 2
  });

  it('strips a UTF-8 BOM', async () => {
    const csv = '﻿SKU,Name\nAB-9,Bommed\n';
    const result = await adapterFor(csv).pull('product', null, 'key-3');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.externalId).toBe('AB-9');
  });

  it('returns nothing for a kind with no source configured', async () => {
    const result = await new CsvSourceAdapter({}).pull('product', null, 'key-4');
    expect(result.items).toEqual([]);
  });

  it('throws FatalError for an unsupported kind', async () => {
    await expect(new CsvSourceAdapter({}).pull('purchase_order', null, 'key-5')).rejects.toBeInstanceOf(
      FatalError,
    );
  });
});

describe('push', () => {
  it('throws FatalError — CSV is read-only', async () => {
    await expect(
      new CsvSourceAdapter({}).push('purchase_order', {} as never, 'key-6'),
    ).rejects.toBeInstanceOf(FatalError);
  });
});
