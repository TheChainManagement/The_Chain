// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderTrack } from '@/components/OrderTrack/OrderTrack';
import type { PurchaseOrderListRow } from '@/lib/purchase-orders/transform';
import { OrderChain } from '@/app/(app)/purchase-orders/OrderChain';

/**
 * Memorable-artifact guard for the PO chain (Block 6, Wave 6.3-A). The order's
 * progress IS the signature object: the hero `OrderChain` ignites cobalt to the
 * reached link, and the compact `OrderTrack` lights the same stages. These assert
 * the chain actually forms from the data, not that it merely renders.
 */

const po = (over: Partial<PurchaseOrderListRow> = {}): PurchaseOrderListRow => ({
  id: 'po-1',
  externalPoId: '301',
  reference: 'PO-1001',
  supplierId: 'sup-1',
  supplierName: 'Atchafalaya Distributing',
  status: 'sent',
  recommendedBy: 'external',
  lineCount: 2,
  total: 840,
  expectedDeliveryAt: '2026-05-28T00:00:00.000Z',
  actualDeliveryAt: null,
  updatedAt: '2026-05-20T11:00:00.000Z',
  ...over,
});

describe('OrderChain (hero)', () => {
  it('an open order ignites SUPPLIER + ORDERED, lights IN TRANSIT, leaves RECEIVED pending', () => {
    const { container } = render(<OrderChain po={po({ status: 'sent' })} />);
    const links = Array.from(container.querySelectorAll('[data-state]'));
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    // Cobalt connectors join the done links; the active link's connector is pewter.
    expect(container.querySelectorAll('[data-connector="cobalt"]')).toHaveLength(2);
  });

  it('a received order lights every link in the chain', () => {
    const { container } = render(<OrderChain po={po({ status: 'closed' })} />);
    const states = Array.from(container.querySelectorAll('[data-state]')).map((l) =>
      l.getAttribute('data-state'),
    );
    expect(states.every((s) => s === 'done')).toBe(true);
  });

  it('cobalt FLOWS INTO the RECEIVED link when the order lands (Block 11b)', () => {
    // The hero moment: a fully-received order fills its terminal link cobalt
    // with the ignite sweep, not the quiet done dot.
    const received = render(
      <OrderChain po={po({ status: 'received', actualDeliveryAt: '2026-05-27T00:00:00.000Z' })} />,
    );
    const links = Array.from(received.container.querySelectorAll('[data-state]'));
    const last = links.at(-1)!;
    expect(last.getAttribute('data-complete')).toBe('true');
    // The ignite sweep span is present on the completed link (the cobalt fill).
    expect(last.querySelector('span[aria-hidden="true"]')).not.toBeNull();

    // While the order is still open, RECEIVED is pending — no celebration yet.
    const open = render(<OrderChain po={po({ status: 'sent' })} />);
    const openLinks = Array.from(open.container.querySelectorAll('[data-state]'));
    expect(openLinks.at(-1)!.getAttribute('data-complete')).toBe('false');
  });
});

describe('OrderTrack (compact)', () => {
  it('lights the reached nodes and labels its progress for assistive tech', () => {
    const { container, getByRole } = render(<OrderTrack po={po({ status: 'sent' })} />);
    expect(getByRole('img').getAttribute('aria-label')).toBe('Order progress: 2 of 4 steps');
    const nodes = Array.from(container.querySelectorAll('[data-state]'));
    expect(nodes.map((n) => n.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
  });
});
