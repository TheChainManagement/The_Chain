import { describe, expect, it } from 'vitest';
import { mapLocationError, validateLocationInput } from '@/lib/locations/transform';

describe('location input', () => {
  it('requires a bounded name and known physical type', () => {
    expect(validateLocationInput({ name: '', type: 'warehouse' }).ok).toBe(false);
    expect(validateLocationInput({ name: 'North', type: 'van' }).ok).toBe(false);
    expect(validateLocationInput({ name: 'North', type: 'warehouse' })).toEqual({ ok: true });
  });

  it('maps lifecycle boundary errors to operator guidance', () => {
    expect(mapLocationError('Location has a non-zero inventory position.')).toMatch(/move or clear/i);
    expect(mapLocationError('Choose another primary location before archiving this one.')).toMatch(
      /another primary/i,
    );
  });
});
