// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderChain } from '@/app/(app)/purchase-orders/OrderChain';
import type { PurchaseOrderListRow } from '@/lib/purchase-orders/transform';

/**
 * Memorable-artifact guard for the PO LIFECYCLE hero (Block 11b). The product's
 * primary loop closes here: a draft is approved (cobalt floods to IN TRANSIT)
 * and received (cobalt FILLS the terminal RECEIVED link — the spring-physics
 * payoff). This asserts the chain represents each stage, and that the completed
 * order lights its final link cobalt rather than the quiet done dot.
 *
 * Paired with the live browser capture in
 * `_reviews/2026-06-13_block11b_approve_receive_stock_evidence.md` (draft →
 * approved → received, real stock moved).
 */

const po = (over: Partial<PurchaseOrderListRow> = {}): PurchaseOrderListRow => ({
  id: 'po-1',
  externalPoId: null,
  reference: 'TC-1001',
  supplierId: 'sup-1',
  supplierName: 'Atchafalaya Distributing',
  status: 'draft',
  recommendedBy: 'system',
  lineCount: 2,
  total: 720,
  expectedDeliveryAt: '2026-06-23T00:00:00.000Z',
  actualDeliveryAt: null,
  updatedAt: '2026-06-13T00:00:00.000Z',
  ...over,
});

function states(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll('[data-state]')).map((l) =>
    l.getAttribute('data-state'),
  );
}

describe('PO lifecycle hero chain (Block 11b)', () => {
  it('a draft sits at ORDERED, waiting to be placed', () => {
    const { container } = render(<OrderChain po={po({ status: 'draft' })} />);
    // SUPPLIER done, ORDERED igniting, the rest waiting.
    expect(states(container)).toEqual(['done', 'active', 'pending', 'pending']);
  });

  it('an approved order floods cobalt forward to IN TRANSIT', () => {
    const { container } = render(<OrderChain po={po({ status: 'exported' })} />);
    expect(states(container)).toEqual(['done', 'done', 'active', 'pending']);
  });

  it('a received order FILLS the terminal RECEIVED link cobalt — the payoff', () => {
    const { container } = render(
      <OrderChain po={po({ status: 'received', actualDeliveryAt: '2026-06-13T00:00:00.000Z' })} />,
    );
    const links = Array.from(container.querySelectorAll('[data-state]'));
    const received = links.at(-1)!;
    // Logical state stays `done` (every link reached); the celebration is the
    // cobalt fill + ignite sweep, asserted via data-complete + the sweep span.
    expect(received.getAttribute('data-state')).toBe('done');
    expect(received.getAttribute('data-complete')).toBe('true');
    expect(received.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });
});
