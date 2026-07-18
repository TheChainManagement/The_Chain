import type { StatTone } from '@/components/StatNumber/StatNumber';
import type { MemberRole } from '@/lib/access';
import { locationHref } from '@/lib/locations/href';

export interface TodayFocusFact {
  label: string;
  value: number | string | null;
  unit?: string;
  tone?: StatTone;
  href: string;
}

export interface TodayFocusValues {
  coveragePct: number | null;
  commitment: number;
  approvals: number;
  stockouts: number;
  missingForecasts: number;
  reorderCount: number;
  receiptsDue: number;
  heldUnits: number;
  cycleCounts: number;
  transfers: number;
  inventoryValue: number;
  supplierExposure: number;
  uncoveredUnits: number;
}

/** Selects emphasis only; every role still reads the same shared snapshot. */
export function buildTodayFocusFacts(
  role: MemberRole,
  values: TodayFocusValues,
  locationId: string | null,
): TodayFocusFact[] {
  const scoped = (path: string) => locationHref(path, locationId);
  const coverage: TodayFocusFact = {
    label: '30-DAY COVERAGE',
    value: values.coveragePct === null ? 'NO DEMAND' : values.coveragePct.toFixed(1),
    unit: values.coveragePct === null ? undefined : '%',
    tone:
      values.coveragePct === null
        ? 'deep'
        : values.coveragePct >= 90
          ? 'flow'
          : values.coveragePct >= 75
            ? 'warn'
            : 'stop',
    href: scoped('/plan'),
  };
  const money = (value: number) =>
    `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  switch (role) {
    case 'owner':
    case 'manager':
      return [
        coverage,
        {
          label: 'OPEN COMMITMENT',
          value: money(values.commitment),
          tone: values.commitment > 0 ? 'warn' : 'deep',
          href: scoped('/purchase-orders'),
        },
        {
          label: 'APPROVALS WAITING',
          value: values.approvals,
          tone: values.approvals > 0 ? 'stop' : 'flow',
          href: scoped('/procurement'),
        },
      ];
    case 'planner':
      return [
        {
          label: 'STOCKOUT RISK',
          value: values.stockouts,
          tone: values.stockouts > 0 ? 'stop' : 'flow',
          href: scoped('/reorder'),
        },
        {
          label: 'FORECAST GAPS',
          value: values.missingForecasts,
          tone: values.missingForecasts > 0 ? 'warn' : 'flow',
          href: scoped('/forecasts'),
        },
        {
          label: 'REORDER QUEUE',
          value: values.reorderCount,
          tone: values.reorderCount > 0 ? 'warn' : 'deep',
          href: scoped('/reorder'),
        },
      ];
    case 'warehouse':
      return [
        {
          label: 'RECEIPTS DUE · 7D',
          value: values.receiptsDue,
          tone: values.receiptsDue > 0 ? 'warn' : 'deep',
          href: scoped('/purchase-orders'),
        },
        {
          label: 'HELD / OPEN COUNTS',
          value: `${values.heldUnits.toLocaleString('en-US', { maximumFractionDigits: 1 })} / ${values.cycleCounts}`,
          tone: values.heldUnits > 0 || values.cycleCounts > 0 ? 'warn' : 'flow',
          href: scoped('/inventory/cycle-counts'),
        },
        {
          label: 'TRANSFER WORK',
          value: values.transfers,
          tone: values.transfers > 0 ? 'warn' : 'deep',
          href: scoped('/transfers'),
        },
      ];
    case 'finance':
      return [
        {
          label: 'INVENTORY VALUE',
          value: money(values.inventoryValue),
          href: scoped('/inventory'),
        },
        {
          label: 'OPEN PO COMMITMENT',
          value: money(values.commitment),
          tone: values.commitment > 0 ? 'warn' : 'deep',
          href: scoped('/purchase-orders'),
        },
        {
          label: 'SUPPLIER EXPOSURE',
          value: values.supplierExposure,
          unit: 'suppliers',
          href: scoped('/purchase-orders'),
        },
      ];
    case 'viewer':
      return [
        coverage,
        {
          label: 'UNCOVERED DEMAND',
          value: values.uncoveredUnits.toLocaleString('en-US', { maximumFractionDigits: 1 }),
          unit: 'units',
          tone: values.uncoveredUnits > 0 ? 'stop' : 'flow',
          href: scoped('/plan'),
        },
        {
          label: 'SUPPLIER EXPOSURE',
          value: values.supplierExposure,
          unit: 'suppliers',
          href: scoped('/purchase-orders'),
        },
      ];
  }
}
