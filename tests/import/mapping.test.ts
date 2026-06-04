import { describe, expect, it } from 'vitest';
import { getKindSpec } from '@/lib/import/field-specs';
import { autoMap, type ColumnMapping, missingRequired, normalizeHeader, unmappedHeaders } from '@/lib/import/mapping';
import { mapRows, rowToPayload } from '@/lib/import/transform';

const productSpec = getKindSpec('product');

describe('normalizeHeader', () => {
  it('strips case, spaces, and punctuation', () => {
    expect(normalizeHeader('Unit Cost')).toBe('unitcost');
    expect(normalizeHeader('item_number')).toBe('itemnumber');
    expect(normalizeHeader('SKU #')).toBe('sku');
  });
});

describe('autoMap (default-from-name heuristic)', () => {
  it('wires obvious columns by key, label, and alias', () => {
    const headers = ['Item Number', 'Product Name', 'UOM', 'Status'];
    const mapping = autoMap(headers, productSpec);
    expect(mapping.sku).toBe('Item Number'); // alias itemnumber
    expect(mapping.name).toBe('Product Name'); // alias productname
    expect(mapping.unitOfMeasure).toBe('UOM'); // alias uom
    expect(mapping.status).toBe('Status'); // label/alias
    expect(mapping.description).toBeNull();
  });

  it('never assigns one header to two fields', () => {
    // "name" and "description" both list 'description' as an alias; the first
    // field to claim a header keeps it.
    const headers = ['SKU', 'Description'];
    const mapping = autoMap(headers, productSpec);
    const used = Object.values(mapping).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it('reports unmapped headers and missing required fields', () => {
    const headers = ['Name', 'Color'];
    const mapping = autoMap(headers, productSpec);
    expect(unmappedHeaders(headers, mapping)).toContain('Color');
    // sku is required and unmapped here
    expect(missingRequired(productSpec, mapping).map((f) => f.key)).toContain('sku');
  });
});

describe('rowToPayload coercion + validation', () => {
  const mapping: ColumnMapping = {
    sku: 'SKU',
    name: 'Name',
    description: null,
    unitOfMeasure: 'UOM',
    status: 'Status',
  };

  it('builds a canonical payload from a clean row', () => {
    const result = rowToPayload(1, { SKU: 'AB-1', Name: 'Widget', UOM: 'each', Status: 'Active' }, productSpec, mapping);
    expect(result.errors).toEqual([]);
    expect(result.payload).toMatchObject({
      kind: 'product',
      externalId: 'AB-1',
      attributes: { sku: 'AB-1', name: 'Widget', unitOfMeasure: 'each', status: 'active' },
      schemaVersion: 1,
    });
  });

  it('defaults an optional enum (status) to its first value when blank', () => {
    const result = rowToPayload(2, { SKU: 'AB-2', Name: 'Gadget', UOM: '', Status: '' }, productSpec, mapping);
    expect(result.payload?.attributes).toMatchObject({ status: 'active' });
  });

  it('normalizes enum spelling and rejects unknown values', () => {
    const ok = rowToPayload(3, { SKU: 'AB-3', Name: 'X', UOM: '', Status: 'Discontinued' }, productSpec, mapping);
    expect(ok.payload?.attributes).toMatchObject({ status: 'discontinued' });

    const bad = rowToPayload(4, { SKU: 'AB-4', Name: 'X', UOM: '', Status: 'frozen' }, productSpec, mapping);
    expect(bad.payload).toBeNull();
    expect(bad.errors[0]).toMatchObject({ row: 4, field: 'status', code: 'invalid_enum' });
  });

  it('flags a missing required field with its row number', () => {
    const result = rowToPayload(7, { SKU: '', Name: 'No SKU', UOM: '', Status: '' }, productSpec, mapping);
    expect(result.payload).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 7, field: 'sku', code: 'missing_required' }),
    );
  });
});

describe('mapRows (valid rows survive bad rows)', () => {
  const mapping: ColumnMapping = { sku: 'SKU', name: 'Name', description: null, unitOfMeasure: null, status: null };

  it('keeps valid payloads and collects errors with row numbers without blocking', () => {
    const rows = [
      { SKU: 'A', Name: 'Alpha' },
      { SKU: '', Name: 'No sku' }, // bad
      { SKU: 'C', Name: 'Gamma' },
    ];
    const result = mapRows(rows, productSpec, mapping);
    expect(result.total).toBe(3);
    expect(result.payloads.map((p) => p.externalId)).toEqual(['A', 'C']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, code: 'missing_required' });
  });
});
