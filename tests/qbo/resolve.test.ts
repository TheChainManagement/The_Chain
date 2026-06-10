import { describe, expect, it } from 'vitest';
import { productFingerprint, supplierFingerprint } from '@/lib/qbo/conflict';
import { planConflictResolution, remoteStateFingerprint, toEntityColumns } from '@/lib/qbo/resolve';

const productConflict = {
  entityType: 'product' as const,
  localState: { name: 'Bolt M6', description: 'Hex bolt', unitOfMeasure: 'ea', status: 'active' },
  remoteState: {
    name: 'Bolt M6x20',
    description: 'Hex bolt',
    unitOfMeasure: 'box',
    status: 'active',
  },
};

const supplierConflict = {
  entityType: 'supplier' as const,
  localState: { name: 'Atchafalaya', status: 'active', contact: { email: 'ops@local' } },
  remoteState: {
    name: 'Atchafalaya Distributing',
    status: 'inactive',
    contact: { email: 'ap@qbo' },
  },
};

describe('remoteStateFingerprint', () => {
  it('matches the sync fingerprint for the same product fields', () => {
    expect(remoteStateFingerprint('product', productConflict.remoteState)).toBe(
      productFingerprint({
        name: 'Bolt M6x20',
        description: 'Hex bolt',
        unitOfMeasure: 'box',
        status: 'active',
      }),
    );
  });

  it('matches the sync fingerprint for the same supplier fields', () => {
    expect(remoteStateFingerprint('supplier', supplierConflict.remoteState)).toBe(
      supplierFingerprint({
        name: 'Atchafalaya Distributing',
        status: 'inactive',
        contact: { email: 'ap@qbo' },
      }),
    );
  });
});

describe('planConflictResolution — accept_local', () => {
  it('writes nothing to the entity but stamps the adjudicated remote fingerprint', () => {
    const plan = planConflictResolution({ ...productConflict, resolution: 'accept_local' });
    expect(plan.columnsToWrite).toBeNull();
    expect(plan.applied).toBe('accept_local');
    expect(plan.newFp).toBe(remoteStateFingerprint('product', productConflict.remoteState));
  });
});

describe('planConflictResolution — accept_remote', () => {
  it('writes every remote QBO-owned field mapped to its DB column', () => {
    const plan = planConflictResolution({ ...productConflict, resolution: 'accept_remote' });
    expect(plan.applied).toBe('accept_remote');
    expect(plan.columnsToWrite).toEqual({
      name: 'Bolt M6x20',
      description: 'Hex bolt',
      unit_of_measure: 'box',
      status: 'active',
    });
  });

  it('maps supplier columns including contact', () => {
    const plan = planConflictResolution({ ...supplierConflict, resolution: 'accept_remote' });
    expect(plan.columnsToWrite).toEqual({
      name: 'Atchafalaya Distributing',
      status: 'inactive',
      contact: { email: 'ap@qbo' },
    });
  });
});

describe('planConflictResolution — merge', () => {
  it('writes the operator blend (local name + remote unit) and still stamps remote fp', () => {
    const mergePayload = {
      name: 'Bolt M6', // kept local
      description: 'Hex bolt',
      unitOfMeasure: 'box', // took remote
      status: 'active',
    };
    const plan = planConflictResolution({ ...productConflict, resolution: 'merge', mergePayload });
    expect(plan.applied).toBe('merge');
    expect(plan.columnsToWrite).toEqual({
      name: 'Bolt M6',
      description: 'Hex bolt',
      unit_of_measure: 'box',
      status: 'active',
    });
    // baseline is always the adjudicated remote, so an unchanged remote won't re-flag.
    expect(plan.newFp).toBe(remoteStateFingerprint('product', productConflict.remoteState));
  });

  it('throws when no merge payload is supplied', () => {
    expect(() => planConflictResolution({ ...productConflict, resolution: 'merge' })).toThrow();
  });

  it('throws when the merge payload is missing a field choice', () => {
    expect(() =>
      planConflictResolution({
        ...productConflict,
        resolution: 'merge',
        mergePayload: { name: 'Bolt M6' }, // missing description/unit/status
      }),
    ).toThrow();
  });
});

describe('toEntityColumns', () => {
  it('coerces absent keys to null rather than dropping the column', () => {
    expect(toEntityColumns('product', { name: 'X' })).toEqual({
      name: 'X',
      description: null,
      unit_of_measure: null,
      status: null,
    });
  });
});
