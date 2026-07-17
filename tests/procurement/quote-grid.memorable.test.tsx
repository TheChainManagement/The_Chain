// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * The quote comparison grid — THE W2-3 memorable element, driven end to end
 * (Phase 6 visible-craft gate artifact). Three vendors' answers land on one
 * bench: the cheapest per-stock-unit cell per row carries the cobalt ignite
 * (data-cheapest), clicking answered cells assembles the requisition in the
 * award tray (picked count + estimated total), "Award column" takes a whole
 * vendor, and "Draft requisition" fires the award with the assembled picks.
 */

const awardQuotesToRequisition = vi.hoisted(() => vi.fn());
const markVendorDeclined = vi.hoisted(() => vi.fn());
const saveVendorQuote = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/procurement/actions', () => ({
  awardQuotesToRequisition,
  markVendorDeclined,
  saveVendorQuote,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { QuoteGrid } from '@/app/(app)/procurement/rfqs/[rfqId]/QuoteGrid';
import type { RfqDetail } from '@/lib/procurement/queries';

const quote = (
  supplierId: string,
  lineNo: number,
  cost: number,
  factor: number | null,
): RfqDetail['quotes'][number] => ({
  supplierId,
  lineNo,
  quotedUnitCost: cost,
  purchaseUom: factor ? 'CS' : null,
  factor,
  leadTimeDays: 5,
  moq: null,
  note: null,
});

const rfq: RfqDetail = {
  id: 'rfq-1',
  title: 'Q3 fasteners',
  note: null,
  status: 'quoted',
  locationId: 'loc-1',
  locationName: 'Main DC',
  respondBy: null,
  sentAt: new Date(0).toISOString(),
  createdAt: new Date(0).toISOString(),
  lines: [
    {
      lineNo: 1,
      productId: 'p1',
      sku: 'BLT-M12-50',
      productName: 'Hex bolt',
      stockUom: 'each',
      qty: 48,
      note: null,
    },
    {
      lineNo: 2,
      productId: 'p2',
      sku: 'GRS-EP2',
      productName: 'Grease cartridge',
      stockUom: 'each',
      qty: 10,
      note: null,
    },
  ],
  vendors: [
    { supplierId: 'a', supplierName: 'Acme Supply', status: 'quoted', sentAt: null },
    { supplierId: 'b', supplierName: 'Bayou Industrial', status: 'quoted', sentAt: null },
  ],
  // Line 1: Acme $24/CS of 12 = $2/ea (cheapest) vs Bayou $3/ea.
  // Line 2: only Bayou answered ($5/ea).
  quotes: [quote('a', 1, 24, 12), quote('b', 1, 3, null), quote('b', 2, 5, null)],
  draftedRequisitions: [],
};

describe('the comparison grid', () => {
  it('ignites the cheapest per-stock-unit cell, not the lowest sticker price', () => {
    render(<QuoteGrid rfq={rfq} linkDefaults={[]} />);
    const acme = screen.getByRole('button', {
      name: 'Acme Supply quoted BLT-M12-50 at 24 (cheapest)',
    });
    expect(acme).toHaveAttribute('data-cheapest', 'true');
    const bayou = screen.getByRole('button', { name: 'Bayou Industrial quoted BLT-M12-50 at 3' });
    expect(bayou).not.toHaveAttribute('data-cheapest');
  });

  it('assembles the award tray as cells are picked and drafts the requisition', async () => {
    awardQuotesToRequisition.mockResolvedValue({ ok: true, requisitionId: 'req-1', total: 146 });
    render(<QuoteGrid rfq={rfq} linkDefaults={[]} />);

    const draft = screen.getByRole('button', { name: 'Draft requisition' });
    expect(draft).toBeDisabled();

    // Pick Acme for line 1 (48 ea ÷ 12 = 4 CS × $24 = $96)…
    await userEvent.click(
      screen.getByRole('button', { name: 'Acme Supply quoted BLT-M12-50 at 24 (cheapest)' }),
    );
    // …and Bayou for line 2 (10 × $5 = $50).
    await userEvent.click(
      screen.getByRole('button', { name: /Bayou Industrial quoted GRS-EP2 at 5/ }),
    );

    expect(screen.getByText('2/2 lines')).toBeInTheDocument();
    expect(screen.getByText('$146.00')).toBeInTheDocument();

    await userEvent.click(draft);
    expect(awardQuotesToRequisition).toHaveBeenCalledWith({
      rfqId: 'rfq-1',
      picks: [
        { lineNo: 1, supplierId: 'a' },
        { lineNo: 2, supplierId: 'b' },
      ],
    });
  });

  it('Award column takes every line that vendor answered', async () => {
    render(<QuoteGrid rfq={rfq} linkDefaults={[]} />);
    const awardButtons = screen.getAllByRole('button', { name: 'Award column' });
    // Bayou is the second vendor column.
    const bayouAward = awardButtons[1];
    if (!bayouAward) throw new Error('missing award column button');
    await userEvent.click(bayouAward);
    expect(screen.getByText('2/2 lines')).toBeInTheDocument();
    expect(screen.getByText(`$${(48 * 3 + 10 * 5).toFixed(2)}`)).toBeInTheDocument();
  });

  it('names a subsequent award as a re-award', () => {
    render(
      <QuoteGrid
        rfq={{
          ...rfq,
          draftedRequisitions: [
            {
              id: 'req-1',
              status: 'draft',
              total: 146,
              createdAt: new Date(0).toISOString(),
              awardVersion: 1,
              isCurrentVersion: true,
            },
          ],
        }}
        linkDefaults={[]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Create re-award' })).toBeDisabled();
  });

  it('an unanswered cell is the entry affordance and opens the pre-filled panel', async () => {
    render(
      <QuoteGrid
        rfq={{ ...rfq, quotes: rfq.quotes.slice(0, 2) }}
        linkDefaults={[{ productId: 'p2', supplierId: 'b', purchaseUom: 'BX', factor: 10 }]}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Enter Bayou Industrial quote for GRS-EP2' }),
    );
    expect(screen.getByText('Bayou Industrial · GRS-EP2 (10 each requested)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('CS')).toHaveValue('BX');
    expect(screen.getByPlaceholderText('1')).toHaveValue(10);
    expect(screen.getByRole('button', { name: 'Save quote' })).toBeInTheDocument();
  });

  it('locks when the request is closed: no entry, no tray', () => {
    render(<QuoteGrid rfq={{ ...rfq, status: 'closed' }} linkDefaults={[]} />);
    expect(screen.queryByRole('button', { name: /Enter .* quote/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draft requisition' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Award column' })).not.toBeInTheDocument();
  });
});
