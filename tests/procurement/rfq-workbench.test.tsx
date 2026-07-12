// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * RfqWorkbench interaction contract (W2-3 slice 2, driveable-craft artifact).
 * A DRAFT is a working document: add-line rail with the catalog datalist,
 * removable lines, removable vendors, "Mark sent" gated on lines + vendors
 * (disabled with the reason in the tooltip). A SENT document locks: no edit
 * affordances, and the per-vendor documents (CSV + print sheet) go live.
 */

const sendRfq = vi.hoisted(() => vi.fn());
const cancelRfq = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/procurement/actions', () => ({
  addRfqLine: vi.fn(),
  removeRfqLine: vi.fn(),
  addRfqVendor: vi.fn(),
  removeRfqVendor: vi.fn(),
  sendRfq,
  cancelRfq,
  closeRfq: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import {
  RfqLines,
  RfqStatusActions,
  RfqVendors,
} from '@/app/(app)/procurement/rfqs/[rfqId]/RfqWorkbench';
import type { RfqDetail } from '@/lib/procurement/queries';

function rfq(overrides: Partial<RfqDetail> = {}): RfqDetail {
  return {
    id: 'rfq-1',
    title: 'Q3 fasteners',
    note: null,
    status: 'draft',
    locationId: 'loc-1',
    locationName: 'Main DC',
    respondBy: null,
    sentAt: null,
    createdAt: new Date(0).toISOString(),
    lines: [
      {
        lineNo: 1,
        productId: 'p1',
        sku: 'BLT-M12-50',
        productName: 'Hex bolt M12x50',
        stockUom: 'each',
        qty: 48,
        note: null,
      },
    ],
    vendors: [{ supplierId: 's1', supplierName: 'Acme Supply', status: 'pending', sentAt: null }],
    quotes: [],
    draftedRequisitions: [],
    ...overrides,
  };
}

const skuOptions = [{ id: 'p1', sku: 'BLT-M12-50', name: 'Hex bolt M12x50' }];
const supplierOptions = [
  { id: 's1', name: 'Acme Supply' },
  { id: 's2', name: 'Bayou Industrial' },
];

describe('draft: a working document', () => {
  it('shows the add-line rail wired to the catalog datalist', () => {
    render(<RfqLines rfq={rfq()} skuOptions={skuOptions} />);
    const skuInput = screen.getByPlaceholderText('Type to search the catalog');
    expect(skuInput).toHaveAttribute('list', 'rfq-sku-options');
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove line 1 (BLT-M12-50)' })).toBeInTheDocument();
  });

  it('offers only vendors not already on the bench', () => {
    render(<RfqVendors rfq={rfq()} supplierOptions={supplierOptions} />);
    const select = screen.getByLabelText('Add vendor');
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Bayou Industrial']); // Acme is already on the request
  });

  it('gates Mark sent on having lines AND vendors, naming the gap', () => {
    render(<RfqStatusActions rfq={rfq({ vendors: [] })} />);
    const send = screen.getByRole('button', { name: 'Mark sent' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', 'Pick at least one vendor before sending.');
  });

  it('fires the send action when the document is complete', async () => {
    sendRfq.mockResolvedValue({ ok: true });
    render(<RfqStatusActions rfq={rfq()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark sent' }));
    expect(sendRfq).toHaveBeenCalledWith({ rfqId: 'rfq-1' });
  });
});

describe('sent: a locked document with live vendor sheets', () => {
  it('drops every edit affordance', () => {
    render(<RfqLines rfq={rfq({ status: 'sent' })} skuOptions={skuOptions} />);
    expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove line/ })).not.toBeInTheDocument();
  });

  it('turns each vendor row into its documents (CSV + print sheet)', () => {
    render(<RfqVendors rfq={rfq({ status: 'sent' })} supplierOptions={supplierOptions} />);
    const csv = screen.getByRole('link', { name: 'CSV ↓' });
    expect(csv).toHaveAttribute('href', '/api/exports/procurement/rfq/rfq-1/s1');
    const sheet = screen.getByRole('link', { name: 'Print sheet' });
    expect(sheet).toHaveAttribute('href', '/print/rfq/rfq-1/s1');
    expect(screen.queryByLabelText('Add vendor')).not.toBeInTheDocument();
  });
});
