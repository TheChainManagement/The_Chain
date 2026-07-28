// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRfqFromRecommendations = vi.hoisted(() => vi.fn());
const submitSelectedPurchaseRequest = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock('@/app/(app)/procurement/actions', () => ({ createRfqFromRecommendations }));
vi.mock('@/app/(app)/reorder/actions', () => ({ submitSelectedPurchaseRequest }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { ReorderQueue } from '@/app/(app)/reorder/ReorderQueue';
import type { ReorderGroup } from '@/lib/reorder/queue';

function group(id: string, sku: string): ReorderGroup {
  return {
    supplierId: 'supplier-1',
    supplierName: 'Gulf Coast Fasteners',
    locationId: 'location-1',
    locationName: 'Houston Hub',
    otifPct: null,
    convertible: true,
    rows: [
      {
        id,
        productId: `product-${id}`,
        locationId: 'location-1',
        sku,
        name: `${sku} part`,
        urgency: 'at_reorder',
        recommendedQty: 10,
        reason: {
          position: 2,
          reorderPoint: 5,
          daysOfSupply: 1,
          safetyStock: 2,
          shortfall: 3,
          computedAt: new Date(0).toISOString(),
          forecastId: null,
        },
      },
    ],
  };
}

const recommendationA = group('recommendation-a', 'PMP-CENT-1');
const recommendationB = group('recommendation-b', 'FLG-WN-4');

beforeEach(() => {
  vi.clearAllMocks();
  submitSelectedPurchaseRequest.mockResolvedValue({
    ok: true,
    destination: 'purchase_order',
    poId: 'purchase-order-b',
    requisitionId: 'requisition-b',
  });
  createRfqFromRecommendations.mockResolvedValue({ ok: true, rfqId: 'rfq-b' });
});

describe('ReorderQueue selection reconciliation', () => {
  it('drops a restored selection when its recommendation is no longer visible', async () => {
    const { rerender } = render(<ReorderQueue groups={[recommendationA]} />);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerender(<ReorderQueue groups={[recommendationB]} />);

    expect(screen.getByText('Select recommendations to order')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Submit purchase request' }));

    await waitFor(() =>
      expect(submitSelectedPurchaseRequest).toHaveBeenCalledWith({
        recommendationIds: ['recommendation-b'],
      }),
    );
    expect(push).toHaveBeenCalledWith('/purchase-orders/purchase-order-b');
  });

  it('clears the selection after a successful purchase request before navigation', async () => {
    render(<ReorderQueue groups={[recommendationA]} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit purchase request' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/purchase-orders/purchase-order-b'));
    expect(screen.getByText('Select recommendations to order')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clears the selection after a successful quote request before navigation', async () => {
    render(<ReorderQueue groups={[recommendationA]} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Request quotes' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/procurement/rfqs/rfq-b'));
    expect(screen.getByText('Select recommendations to order')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
