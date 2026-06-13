// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReorderQueue } from '@/app/(app)/reorder/ReorderQueue';
import type { ReorderGroup } from '@/lib/reorder/queue';

/**
 * Memorable-element artifact (Block 11, MASTER_PROMPT "visible craft" gate).
 *
 * The reorder queue is the product's primary action loop: every breached SKU
 * surfaces with its REASON (position vs reorder point, days of supply), grouped
 * by supplier with the supplier's OTIF context, and you select a same-supplier
 * set and turn it into a purchase order in one move. This drives the REAL
 * ReorderQueue: the reason is visible, urgency is toned, selection is fenced to
 * ONE supplier group (a PO has one vendor), and the convert action fires with
 * exactly the selected ids.
 */

const convertMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, poId: 'po-new' }) as const);
vi.mock('@/app/(app)/reorder/actions', () => ({
  convertSelectedToPo: (...a: unknown[]) => convertMock(...a),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const reason = (over: Partial<ReorderGroup['rows'][number]['reason']> = {}) => ({
  position: 40,
  reorderPoint: 57,
  safetyStock: 12,
  daysOfSupply: 6.2,
  shortfall: 17,
  computedAt: '2026-06-12T00:00:00Z',
  forecastId: 'f1',
  ...over,
});

const GROUPS: ReorderGroup[] = [
  {
    supplierId: 's-atch',
    supplierName: 'Atchafalaya Distributing',
    locationId: 'l1',
    locationName: 'Hammond DC',
    otifPct: 0.94,
    convertible: true,
    rows: [
      {
        id: 'r1',
        productId: 'p1',
        locationId: 'l1',
        sku: 'RVB-1107',
        name: '1/2 in PVC Coupling',
        recommendedQty: 280,
        reason: reason({ position: 0, safetyStock: 12 }),
        urgency: 'stockout',
      },
      {
        id: 'r2',
        productId: 'p2',
        locationId: 'l1',
        sku: 'RVB-2214',
        name: 'Drip Line 100 ft',
        recommendedQty: 137,
        reason: reason(),
        urgency: 'at_reorder',
      },
    ],
  },
  {
    supplierId: 's-verm',
    supplierName: 'Vermilion Supply Co',
    locationId: 'l1',
    locationName: 'Hammond DC',
    otifPct: null,
    convertible: true,
    rows: [
      {
        id: 'r3',
        productId: 'p3',
        locationId: 'l1',
        sku: 'RVB-3321',
        name: 'Brass Backflow Valve',
        recommendedQty: 24,
        reason: reason({ position: 8, safetyStock: 12 }),
        urgency: 'below_safety',
      },
    ],
  },
];

describe('Reorder queue (memorable element)', () => {
  it('shows each recommendation’s reason and toned urgency', () => {
    render(<ReorderQueue groups={GROUPS} />);
    expect(screen.getByText('0 on hand vs 57 reorder point · 6.2d of supply')).toBeTruthy();
    expect(screen.getByText('40 on hand vs 57 reorder point · 6.2d of supply')).toBeTruthy();
    expect(screen.getByText('OUT OF STOCK')).toBeTruthy();
    expect(screen.getByText('AT REORDER')).toBeTruthy();
    expect(screen.getByText('BELOW SAFETY')).toBeTruthy();
  });

  it('groups by supplier with the OTIF scorecard context', () => {
    render(<ReorderQueue groups={GROUPS} />);
    expect(screen.getByText('Atchafalaya Distributing')).toBeTruthy();
    expect(screen.getByText('OTIF 94%')).toBeTruthy();
    expect(screen.getByText('OTIF —')).toBeTruthy(); // no scorecard yet
  });

  it('fences selection to ONE supplier — selecting in a new group resets', () => {
    render(<ReorderQueue groups={GROUPS} />);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0] as Element); // Atchafalaya row 1
    fireEvent.click(boxes[1] as Element); // Atchafalaya row 2
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(boxes[2] as Element); // Vermilion → resets to 1
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('converts exactly the selected set to a PO and routes to it', () => {
    render(<ReorderQueue groups={GROUPS} />);
    const atch = screen.getByRole('region', { name: 'Atchafalaya Distributing' });
    fireEvent.click(within(atch).getByText('Select all 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase order' }));
    expect(convertMock).toHaveBeenCalledWith({ recommendationIds: ['r1', 'r2'] });
  });

  it('disables convert until something is selected', () => {
    render(<ReorderQueue groups={GROUPS} />);
    const cta = screen.getByRole('button', { name: 'Create purchase order' }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('fences selection by (supplier, location) — same supplier, two locations is two sets', () => {
    // Same supplier, DIFFERENT location: the convert contract rejects a mixed
    // location set, so the queue keeps them as separate selectable groups.
    const SPLIT: ReorderGroup[] = [
      {
        supplierId: 's-atch',
        supplierName: 'Atchafalaya Distributing',
        locationId: 'l1',
        locationName: 'Hammond DC',
        otifPct: 0.94,
        convertible: true,
        rows: [
          {
            id: 'a1',
            productId: 'p1',
            locationId: 'l1',
            sku: 'RVB-1107',
            name: 'PVC',
            recommendedQty: 100,
            reason: reason(),
            urgency: 'at_reorder',
          },
        ],
      },
      {
        supplierId: 's-atch',
        supplierName: 'Atchafalaya Distributing',
        locationId: 'l2',
        locationName: 'Lafourche Yard',
        otifPct: 0.94,
        convertible: true,
        rows: [
          {
            id: 'a2',
            productId: 'p1',
            locationId: 'l2',
            sku: 'RVB-1107',
            name: 'PVC',
            recommendedQty: 50,
            reason: reason(),
            urgency: 'at_reorder',
          },
        ],
      },
    ];
    render(<ReorderQueue groups={SPLIT} />);
    expect(screen.getByText('Hammond DC')).toBeTruthy();
    expect(screen.getByText('Lafourche Yard')).toBeTruthy();

    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0] as Element); // Hammond
    fireEvent.click(boxes[1] as Element); // Lafourche → different group, resets
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase order' }));
    // Only the Lafourche row — never a cross-location mix.
    expect(convertMock).toHaveBeenCalledWith({ recommendationIds: ['a2'] });
  });
});
