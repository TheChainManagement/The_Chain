// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * RequisitionWorkbench interaction contract (W2-3 slice 4). The approval
 * document's rules made visible: a manager who is not the requester gets
 * Approve/Reject (reject demands a note); the REQUESTER sees why they cannot
 * decide their own submission; approved converts to POs; every costed line
 * carries the explicit update-link-price affordance (design §8), which
 * disappears once the link already matches.
 */

const approveRequisition = vi.hoisted(() => vi.fn());
const rejectRequisition = vi.hoisted(() => vi.fn());
const convertRequisition = vi.hoisted(() => vi.fn());
const updateSupplierLinkPrice = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/procurement/actions', () => ({
  approveRequisition,
  rejectRequisition,
  convertRequisition,
  updateSupplierLinkPrice,
  submitRequisition: vi.fn(),
  cancelRequisition: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import {
  RequisitionActions,
  RequisitionLines,
} from '@/app/(app)/procurement/requisitions/[requisitionId]/RequisitionWorkbench';
import type { RequisitionDetail } from '@/lib/procurement/queries';

function requisition(overrides: Partial<RequisitionDetail> = {}): RequisitionDetail {
  return {
    id: 'req-1',
    status: 'submitted',
    locationName: 'Main DC',
    sourceRfqId: 'rfq-1',
    sourceRfqTitle: 'Q3 fasteners',
    requestedByUserId: 'requester',
    rejectionNote: null,
    total: 146,
    createdAt: new Date(0).toISOString(),
    lines: [
      {
        lineNo: 1,
        productId: 'p1',
        sku: 'BLT-M12-50',
        productName: 'Hex bolt',
        supplierId: 's1',
        supplierName: 'Acme Supply',
        qty: 4,
        unitCost: 24,
        purchaseUom: 'CS',
        factor: 12,
        linkUnitCost: 30,
        linkPurchaseUom: 'CS',
        linkFactor: 12,
      },
    ],
    purchaseOrders: [],
    ...overrides,
  };
}

describe('the decision gate (design §7.1)', () => {
  it('a manager who is not the requester can approve', async () => {
    approveRequisition.mockResolvedValue({ ok: true });
    render(
      <RequisitionActions
        requisition={requisition()}
        viewer={{ userId: 'approver', role: 'manager' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveRequisition).toHaveBeenCalledWith({ requisitionId: 'req-1' });
  });

  it('reject demands a note and sends it', async () => {
    rejectRequisition.mockResolvedValue({ ok: true });
    render(
      <RequisitionActions
        requisition={requisition()}
        viewer={{ userId: 'approver', role: 'owner' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    await userEvent.type(screen.getByLabelText('Rejection note'), 'Price too high');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(rejectRequisition).toHaveBeenCalledWith({
      requisitionId: 'req-1',
      note: 'Price too high',
    });
  });

  it('the requester sees WHY they cannot decide their own submission', () => {
    render(
      <RequisitionActions
        requisition={requisition()}
        viewer={{ userId: 'requester', role: 'owner' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText('You cannot approve your own requisition.')).toBeInTheDocument();
  });

  it('a planner cannot decide at all', () => {
    render(
      <RequisitionActions
        requisition={requisition()}
        viewer={{ userId: 'someone', role: 'planner' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Only an owner or manager can decide a requisition.'),
    ).toBeInTheDocument();
  });
});

describe('convert + the link-price affordance', () => {
  it('approved offers Convert to purchase orders', async () => {
    convertRequisition.mockResolvedValue({ ok: true, pos: [], applied: true });
    render(
      <RequisitionActions
        requisition={requisition({ status: 'approved' })}
        viewer={{ userId: 'approver', role: 'manager' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Convert to purchase orders' }));
    expect(convertRequisition).toHaveBeenCalledWith({ requisitionId: 'req-1' });
  });

  it('a costed line whose link is stale offers Update link price', async () => {
    updateSupplierLinkPrice.mockResolvedValue({ ok: true });
    render(<RequisitionLines requisition={requisition()} />);
    const btn = screen.getByRole('button', { name: 'Update link price' });
    await userEvent.click(btn);
    expect(updateSupplierLinkPrice).toHaveBeenCalledWith({ requisitionId: 'req-1', lineNo: 1 });
  });

  it('a line whose link already matches reads Link current instead', () => {
    const req = requisition();
    const line = req.lines[0];
    if (!line) throw new Error('fixture line missing');
    line.linkUnitCost = 24;
    render(<RequisitionLines requisition={req} />);
    expect(screen.queryByRole('button', { name: 'Update link price' })).not.toBeInTheDocument();
    expect(screen.getByText('Link current')).toBeInTheDocument();
  });
});
