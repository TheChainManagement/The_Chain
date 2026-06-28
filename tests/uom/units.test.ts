import { describe, expect, it } from 'vitest';
import { isKnownUom, UOM_OPTIONS, uomLabel, uomOptionGroups } from '@/lib/uom/units';

describe('unit-of-measure reference (W2-1b)', () => {
  it('has unique, non-empty codes and labels', () => {
    expect(UOM_OPTIONS.length).toBeGreaterThan(0);
    const codes = UOM_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const o of UOM_OPTIONS) {
      expect(o.code).not.toBe('');
      expect(o.label).not.toBe('');
    }
  });

  it('labels a known code, passes through custom/legacy values, and blanks empty', () => {
    expect(uomLabel('ea')).toBe('Each');
    expect(uomLabel('kg')).toBe('Kilogram');
    expect(uomLabel('spool')).toBe('spool'); // custom value displays as-is
    expect(uomLabel('')).toBe('');
    expect(uomLabel(null)).toBe('');
    expect(uomLabel(undefined)).toBe('');
  });

  it('knows curated codes from custom ones', () => {
    expect(isKnownUom('ea')).toBe(true);
    expect(isKnownUom('spool')).toBe(false);
    expect(isKnownUom('')).toBe(false);
    expect(isKnownUom(null)).toBe(false);
  });

  it('groups options by category in declared order, covering every option once', () => {
    const groups = uomOptionGroups();
    expect(groups.map((g) => g.category)).toEqual(['Count', 'Weight', 'Volume', 'Length']);
    const flat = groups.flatMap((g) => g.options);
    expect(flat).toHaveLength(UOM_OPTIONS.length);
  });
});
