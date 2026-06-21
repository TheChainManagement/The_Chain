import { describe, expect, it } from 'vitest';
import {
  type CatalogConflictInputs,
  decideCatalogConflict,
  productFingerprint,
  supplierFingerprint,
} from '@/lib/qbo/conflict';

const base = (over: Partial<CatalogConflictInputs> = {}): CatalogConflictInputs => ({
  hasLocal: true,
  storedFp: 'A',
  localFp: 'A',
  incomingFp: 'A',
  localUpdatedAt: '2026-06-01T00:00:00.000Z',
  incomingExternalUpdatedAt: '2026-06-02T00:00:00.000Z',
  ...over,
});

describe('fingerprints', () => {
  it('are stable and field-sensitive', () => {
    const a = productFingerprint({ name: 'Bolt', status: 'active' });
    expect(productFingerprint({ name: 'Bolt', status: 'active' })).toBe(a);
    expect(productFingerprint({ name: 'Washer', status: 'active' })).not.toBe(a);
  });
  it('supplier contact order does not change the fingerprint', () => {
    const a = supplierFingerprint({
      name: 'Acme',
      status: 'active',
      contact: { email: 'a', phone: 'b' },
    });
    const b = supplierFingerprint({
      name: 'Acme',
      status: 'active',
      contact: { phone: 'b', email: 'a' },
    });
    expect(a).toBe(b);
  });
});

describe('decideCatalogConflict', () => {
  it('inserts when there is no local row', () => {
    expect(decideCatalogConflict(base({ hasLocal: false })).action).toBe('insert');
  });

  it('adopts remote with no conflict when there is no stored baseline (legacy row)', () => {
    const d = decideCatalogConflict(base({ storedFp: null, localFp: 'X', incomingFp: 'Y' }));
    expect(d.action).toBe('apply');
    expect(d.conflict).toBeUndefined();
  });

  it('keeps local when the remote QBO fields did not change', () => {
    const d = decideCatalogConflict(base({ storedFp: 'A', incomingFp: 'A', localFp: 'B' }));
    expect(d.action).toBe('keep');
    expect(d.conflict).toBeUndefined();
  });

  it('applies a clean refresh when remote changed and local is untouched', () => {
    const d = decideCatalogConflict(base({ storedFp: 'A', localFp: 'A', incomingFp: 'B' }));
    expect(d.action).toBe('apply');
    expect(d.conflict).toBeUndefined();
  });

  it('LWW: remote newer → apply + accept_remote conflict', () => {
    const d = decideCatalogConflict(
      base({
        storedFp: 'A',
        localFp: 'L',
        incomingFp: 'R',
        localUpdatedAt: '2026-06-01T00:00:00.000Z',
        incomingExternalUpdatedAt: '2026-06-05T00:00:00.000Z',
      }),
    );
    expect(d.action).toBe('apply');
    expect(d.conflict).toEqual({
      policyDecision: 'last_write_wins',
      appliedResolution: 'accept_remote',
    });
  });

  it('LWW: local newer → keep + accept_local conflict', () => {
    const d = decideCatalogConflict(
      base({
        storedFp: 'A',
        localFp: 'L',
        incomingFp: 'R',
        localUpdatedAt: '2026-06-09T00:00:00.000Z',
        incomingExternalUpdatedAt: '2026-06-05T00:00:00.000Z',
      }),
    );
    expect(d.action).toBe('keep');
    expect(d.conflict).toEqual({
      policyDecision: 'last_write_wins',
      appliedResolution: 'accept_local',
    });
  });

  it('needs_review when both changed but the clocks are equal/missing', () => {
    const equal = decideCatalogConflict(
      base({
        storedFp: 'A',
        localFp: 'L',
        incomingFp: 'R',
        localUpdatedAt: '2026-06-05T00:00:00.000Z',
        incomingExternalUpdatedAt: '2026-06-05T00:00:00.000Z',
      }),
    );
    expect(equal.action).toBe('keep');
    expect(equal.conflict).toEqual({
      policyDecision: 'needs_review',
      appliedResolution: 'pending',
    });

    const missing = decideCatalogConflict(
      base({ storedFp: 'A', localFp: 'L', incomingFp: 'R', incomingExternalUpdatedAt: null }),
    );
    expect(missing.conflict?.policyDecision).toBe('needs_review');
  });
});
