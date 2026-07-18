import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/lib/access';
import { buildTodayFocusFacts, type TodayFocusValues } from '@/lib/dashboard/role-focus';

const VALUES: TodayFocusValues = {
  coveragePct: 82.5,
  commitment: 45_000,
  approvals: 2,
  stockouts: 4,
  missingForecasts: 3,
  reorderCount: 7,
  receiptsDue: 5,
  heldUnits: 12,
  cycleCounts: 1,
  transfers: 2,
  inventoryValue: 230_000,
  supplierExposure: 6,
  uncoveredUnits: 38,
};

describe('role-emphasized Today bench', () => {
  it('selects one coherent three-fact lens for every canonical role', () => {
    const labels = Object.fromEntries(
      MEMBER_ROLES.map((role) => [
        role,
        buildTodayFocusFacts(role, VALUES, null).map((fact) => fact.label),
      ]),
    );

    expect(labels.owner).toEqual([
      '30-DAY COVERAGE',
      'OPEN COMMITMENT',
      'APPROVALS WAITING',
    ]);
    expect(labels.manager).toEqual(labels.owner);
    expect(labels.planner).toEqual(['STOCKOUT RISK', 'FORECAST GAPS', 'REORDER QUEUE']);
    expect(labels.warehouse).toEqual([
      'RECEIPTS DUE · 7D',
      'HELD / OPEN COUNTS',
      'TRANSFER WORK',
    ]);
    expect(labels.finance).toEqual([
      'INVENTORY VALUE',
      'OPEN PO COMMITMENT',
      'SUPPLIER EXPOSURE',
    ]);
    expect(labels.viewer).toEqual([
      '30-DAY COVERAGE',
      'UNCOVERED DEMAND',
      'SUPPLIER EXPOSURE',
    ]);
  });

  it('preserves the authorized location scope in every drill-down', () => {
    const locationId = '12345678-1234-4234-8234-123456789abc';
    for (const role of MEMBER_ROLES) {
      for (const fact of buildTodayFocusFacts(role, VALUES, locationId)) {
        expect(fact.href).toContain(`location=${locationId}`);
      }
    }
  });

  it('renders zero planned demand honestly instead of 100% coverage', () => {
    const [coverage] = buildTodayFocusFacts('viewer', { ...VALUES, coveragePct: null }, null);
    expect(coverage).toMatchObject({ value: 'NO DEMAND', unit: undefined, tone: 'deep' });
  });
});
