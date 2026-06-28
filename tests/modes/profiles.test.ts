import { describe, expect, it } from 'vitest';
import { allProfiles, DEFAULT_MODE, getProfile } from '@/lib/modes/profiles';
import type { OperatingMode } from '@/lib/modes/types';

describe('operating-mode profiles (W2-0)', () => {
  it('resolves each mode to its own profile', () => {
    expect(getProfile('distribution').label).toBe('Distribution');
    expect(getProfile('storeroom').label).toBe('Storeroom');
    expect(getProfile('food').label).toBe('Food service');
  });

  it('declares the demand archetype + noun per mode', () => {
    expect(getProfile('distribution').archetype).toBe('sell');
    expect(getProfile('distribution').demandNoun).toBe('sales');
    expect(getProfile('storeroom').archetype).toBe('issue');
    expect(getProfile('storeroom').demandNoun).toBe('issues');
    expect(getProfile('food').demandNoun).toBe('usage');
  });

  it('relabels the inventory nav per mode; distribution keeps the baseline', () => {
    // Distribution is the Wave-1 baseline — no overrides.
    expect(getProfile('distribution').navLabels).toEqual({});
    // Storeroom + food rename the same nav slot to their own term.
    expect(getProfile('storeroom').navLabels['/inventory']).toBe('Storeroom');
    expect(getProfile('food').navLabels['/inventory']).toBe('Stock');
  });

  it('hides no nav yet (mode-specific surfaces arrive in W2-2+)', () => {
    for (const p of allProfiles()) {
      expect(p.hiddenNav).toEqual([]);
    }
  });

  it('falls back to the default mode for null / undefined / unknown keys', () => {
    expect(DEFAULT_MODE).toBe('distribution');
    expect(getProfile(null).key).toBe('distribution');
    expect(getProfile(undefined).key).toBe('distribution');
    // A value outside the enum (defensive — the DB enum should prevent it).
    expect(getProfile('manufacturing' as OperatingMode).key).toBe('distribution');
  });

  it('exposes every profile in display order, each keyed to itself', () => {
    const profiles = allProfiles();
    expect(profiles.map((p) => p.key)).toEqual(['distribution', 'storeroom', 'food']);
    for (const p of profiles) {
      expect(getProfile(p.key)).toBe(p);
    }
  });
});
