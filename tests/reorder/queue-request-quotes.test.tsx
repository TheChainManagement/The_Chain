// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * W2-3 slice 2: the reorder queue's second exit. The same fenced selection that
 * becomes a PO can become a draft RFQ instead ("Request quotes"); the
 * recommendations stay open because quoting precedes ordering.
 */

const createRfqFromRecommendations = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/procurement/actions', () => ({ createRfqFromRecommendations }));
vi.mock('@/app/(app)/reorder/actions', () => ({ submitSelectedPurchaseRequest: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { ReorderQueue } from '@/app/(app)/reorder/ReorderQueue';
import type { ReorderGroup } from '@/lib/reorder/queue';

const group: ReorderGroup = {
  supplierId: 's1',
  supplierName: 'Gulf Coast Fasteners',
  locationId: 'loc-1',
  locationName: 'Central Storeroom',
  otifPct: null,
  convertible: true,
  rows: [
    {
      id: 'rec-1',
      productId: 'p1',
      locationId: 'loc-1',
      sku: 'BLT-M12-50',
      name: 'Hex bolt M12x50',
      urgency: 'at_reorder',
      recommendedQty: 100,
      reason: {
        position: 43,
        reorderPoint: 60,
        daysOfSupply: 4.2,
        safetyStock: 20,
        shortfall: 17,
        computedAt: new Date(0).toISOString(),
        forecastId: null,
      },
    },
  ],
};

describe('Request quotes from the reorder queue', () => {
  it('sends the selected recommendation ids to the RFQ action and lands on the draft', async () => {
    createRfqFromRecommendations.mockResolvedValue({ ok: true, rfqId: 'rfq-9' });
    render(<ReorderQueue groups={[group]} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Request quotes' }));

    expect(createRfqFromRecommendations).toHaveBeenCalledWith({ recommendationIds: ['rec-1'] });
    expect(push).toHaveBeenCalledWith('/procurement/rfqs/rfq-9');
  });

  it('is disabled with nothing selected', () => {
    render(<ReorderQueue groups={[group]} />);
    expect(screen.getByRole('button', { name: 'Request quotes' })).toBeDisabled();
  });
});
