// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * W2-2.5 memorable element — the receive CONVERSION RAIL. A line bought in a
 * purchase unit shows a live mono readout under its qty input (× factor →
 * stock units) that lights as the operator types; a non-whole stock result
 * raises the FRACTIONAL tag (MG 2026-07-09: fractional stock is allowed,
 * flagged, never rounded). A line with no factor shows no rail.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/app/(app)/purchase-orders/[poId]/actions', () => ({
  markPurchaseOrderReceived: vi.fn(),
}));

import { ReceiveControls } from '@/app/(app)/purchase-orders/[poId]/ReceiveControls';
import type { PurchaseOrderLine } from '@/lib/purchase-orders/transform';

const caseLine: PurchaseOrderLine = {
  lineNo: 1,
  productId: 'p1',
  sku: 'CPR-2210',
  name: 'Copper fitting',
  orderedQty: 25,
  receivedQty: 0,
  unitCost: 24.0,
  stockUom: 'ea',
  purchaseUom: 'case',
  purchaseToStockFactor: 12,
};

const plainLine: PurchaseOrderLine = {
  lineNo: 2,
  productId: 'p2',
  sku: 'RBH-4471',
  name: 'Rubber housing',
  orderedQty: 40,
  receivedQty: 0,
  unitCost: 3.15,
  stockUom: 'ea',
  purchaseUom: null,
  purchaseToStockFactor: null,
};

async function open(lines: PurchaseOrderLine[]): Promise<void> {
  render(<ReceiveControls poId="po-1" lines={lines} />);
  await userEvent.click(screen.getByRole('button', { name: 'Receive delivery' }));
}

describe('receive conversion rail (memorable)', () => {
  it('shows the live purchase → stock conversion for a factored line', async () => {
    await open([caseLine]);
    // Default qty = outstanding (25 cases) → 300 ea, whole → no fractional tag.
    const rail = screen.getByRole('status');
    expect(rail.textContent).toContain('× 12');
    expect(rail.textContent).toContain('300');
    expect(rail.textContent).toContain('ea');
    expect(rail.textContent).not.toContain('fractional');
  });

  it('raises the FRACTIONAL tag when the stock result is not whole', async () => {
    await open([caseLine]);
    const input = screen.getByLabelText('Received quantity for CPR-2210 in case');
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    // 2.5 case × 12 = 30 ea — whole. Make it fractional: 2.55 × 12 = 30.6.
    await userEvent.clear(input);
    await userEvent.type(input, '2.55');
    const rail = screen.getByRole('status');
    expect(rail.textContent).toContain('30.6');
    expect(rail.textContent).toContain('fractional');
  });

  it('renders no rail for a line bought in the stock unit', async () => {
    await open([plainLine]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
