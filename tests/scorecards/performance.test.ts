import { describe, expect, it } from 'vitest';
import {
  assessReceipt,
  leadTimeDays,
  type PerformanceRow,
  rollupWindow,
  windowRows,
} from '@/lib/scorecards/performance';

describe('assessReceipt — one delivery’s verdict', () => {
  it('on-time + in-full ⇒ OTIF', () => {
    expect(
      assessReceipt({
        promisedDeliveryAt: '2026-06-10',
        actualDeliveryAt: '2026-06-10T14:00:00Z',
        orderedQty: 100,
        receivedQty: 100,
      }),
    ).toEqual({ onTime: true, inFull: true, otif: true });
  });

  it('late but full ⇒ on-time false, OTIF false', () => {
    const a = assessReceipt({
      promisedDeliveryAt: '2026-06-10',
      actualDeliveryAt: '2026-06-12T09:00:00Z',
      orderedQty: 100,
      receivedQty: 100,
    });
    expect(a).toMatchObject({ onTime: false, inFull: true, otif: false });
  });

  it('on-time but short ⇒ in-full false, OTIF false', () => {
    const a = assessReceipt({
      promisedDeliveryAt: '2026-06-10',
      actualDeliveryAt: '2026-06-09T09:00:00Z',
      orderedQty: 100,
      receivedQty: 80,
    });
    expect(a).toMatchObject({ onTime: true, inFull: false, otif: false });
  });

  it('same-day delivery counts as on-time', () => {
    expect(
      assessReceipt({
        promisedDeliveryAt: '2026-06-10T00:00:00Z',
        actualDeliveryAt: '2026-06-10T23:59:00Z',
        orderedQty: 10,
        receivedQty: 10,
      }).onTime,
    ).toBe(true);
  });

  it('no promised date ⇒ timing unknown, OTIF falls back to in-full', () => {
    expect(
      assessReceipt({
        promisedDeliveryAt: null,
        actualDeliveryAt: '2026-06-10T09:00:00Z',
        orderedQty: 10,
        receivedQty: 10,
      }),
    ).toEqual({ onTime: null, inFull: true, otif: true });
  });
});

describe('leadTimeDays — realized order-to-door', () => {
  it('computes whole-day duration', () => {
    expect(leadTimeDays('2026-06-01T00:00:00Z', '2026-06-09T00:00:00Z')).toBe(8);
  });
  it('rejects a delivery before the order (bad data)', () => {
    expect(leadTimeDays('2026-06-09', '2026-06-01')).toBeNull();
  });
  it('is null when either end is missing', () => {
    expect(leadTimeDays(null, '2026-06-09')).toBeNull();
    expect(leadTimeDays('2026-06-01', null)).toBeNull();
  });
});

const row = (over: Partial<PerformanceRow>): PerformanceRow => ({
  onTime: true,
  inFull: true,
  otif: true,
  deliveryAt: '2026-06-10T00:00:00Z',
  recordedAt: '2026-06-10T00:00:00Z',
  leadTimeDays: 8,
  ...over,
});

describe('rollupWindow — supplier stats', () => {
  it('empty ⇒ all null, sample 0', () => {
    expect(rollupWindow([])).toMatchObject({ otifPct: null, sampleSize: 0 });
  });

  it('percentages as fractions; lead-time avg + population stddev', () => {
    const stats = rollupWindow([
      row({ leadTimeDays: 6 }),
      row({ otif: false, onTime: false, leadTimeDays: 10 }),
    ]);
    expect(stats.sampleSize).toBe(2);
    expect(stats.inFullPct).toBe(1);
    expect(stats.onTimePct).toBe(0.5);
    expect(stats.otifPct).toBe(0.5);
    expect(stats.leadTimeAvgDays).toBe(8);
    expect(stats.leadTimeStddevDays).toBe(2); // pop stddev of {6,10}
  });

  it('a null-timing row lowers in-full but not on-time/OTIF rates', () => {
    const stats = rollupWindow([
      row({ onTime: true, otif: true, inFull: true }),
      row({ onTime: null, otif: null, inFull: false, leadTimeDays: null }),
    ]);
    expect(stats.onTimePct).toBe(1); // only the one timed row counts
    expect(stats.otifPct).toBe(1);
    expect(stats.inFullPct).toBe(0.5); // both rows count for in-full
    expect(stats.leadTimeAvgDays).toBe(8); // only the row with a lead time
  });
});

describe('windowRows — anchored on DELIVERY date, not entry time', () => {
  const now = Date.parse('2026-06-30T00:00:00Z');
  const rows = [
    row({ deliveryAt: '2026-06-20T00:00:00Z' }), // delivered 10d ago
    row({ deliveryAt: '2026-05-01T00:00:00Z' }), // 60d ago
    row({ deliveryAt: '2025-08-01T00:00:00Z' }), // ~333d ago
  ];
  it('rolling_30d keeps only the recent delivery', () => {
    expect(windowRows(rows, 30, now)).toHaveLength(1);
  });
  it('rolling_90d keeps two', () => {
    expect(windowRows(rows, 90, now)).toHaveLength(2);
  });
  it('all_time (null) keeps everything', () => {
    expect(windowRows(rows, null, now)).toHaveLength(3);
  });
  it('a late-ENTERED old delivery still lands in its real window, not today’s', () => {
    // Delivered 200d ago but recorded today — must NOT count in the 30d window.
    const backdated = row({ deliveryAt: '2025-12-12T00:00:00Z', recordedAt: now.toString() });
    expect(windowRows([backdated], 30, now)).toHaveLength(0);
    expect(windowRows([backdated], 365, now)).toHaveLength(1);
  });
});
