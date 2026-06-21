import { describe, expect, it } from 'vitest';
import { ALERT_KIND_LABEL, relativeAge } from '@/lib/alerts/format';
import type { AlertView } from '@/lib/alerts/queue';
import { openAlertCounts } from '@/lib/alerts/queue';

/** Queue read-model helpers (in-app alerts engine) — pure. */

const view = (over: Partial<AlertView>): AlertView => ({
  id: 'a',
  kind: 'reorder_due',
  severity: 'info',
  memo: 'm',
  ctaLabel: 'c',
  ctaHref: '/',
  reopenCount: 0,
  createdAt: '2026-06-13T00:00:00.000Z',
  ...over,
});

describe('relativeAge', () => {
  const base = Date.parse('2026-06-13T12:00:00.000Z');
  it('buckets minutes, hours, days', () => {
    expect(relativeAge('2026-06-13T12:00:00.000Z', base)).toBe('now');
    expect(relativeAge('2026-06-13T11:42:00.000Z', base)).toBe('18m');
    expect(relativeAge('2026-06-13T09:00:00.000Z', base)).toBe('3h');
    expect(relativeAge('2026-06-10T12:00:00.000Z', base)).toBe('3d');
  });
  it('is safe on a bad date', () => {
    expect(relativeAge('not-a-date', base)).toBe('');
  });
});

describe('openAlertCounts + kind labels', () => {
  it('counts by severity', () => {
    const counts = openAlertCounts([
      view({ severity: 'critical' }),
      view({ severity: 'critical' }),
      view({ severity: 'warn' }),
    ]);
    expect(counts).toEqual({ critical: 2, warn: 1, info: 0 });
  });
  it('labels every kind', () => {
    expect(ALERT_KIND_LABEL.reorder_due).toBe('Reorder');
    expect(ALERT_KIND_LABEL.po_late).toBe('Late PO');
    expect(ALERT_KIND_LABEL.sync_conflict).toBe('Conflict');
  });
});
