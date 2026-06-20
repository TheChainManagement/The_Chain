// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuditEventView } from '@/lib/audit/queries';

/**
 * Memorable-artifact guard for the Audit Log (Block 14a). The memorable element:
 * the trail renders as a continuous vertical CHAIN OF EVENTS — a hairline spine
 * with one node per change — and today's entries carry a FILLED deep-slate node
 * (the "you are here" marker). Each link expands its before/after diff on click.
 *
 * This drives the real AuditChain client component: it asserts the chain renders
 * a node per entry, the today entry is marked, and clicking a link reveals the
 * field diff inline. Paired with the live browser capture in
 * `_reviews/2026-06-19_block14a-audit-log.md`.
 */

const { AuditChain } = await import('@/app/(app)/flow/audit-log/AuditChain');
type AuditChainProps = Parameters<typeof AuditChain>[0];

const events: AuditEventView[] = [
  {
    id: '3',
    occurredAt: '2026-06-19T14:00:00.000Z',
    action: 'inventory_levels.update',
    entityType: 'inventory_levels',
    entityLabel: 'Stock level',
    entityId: 'aaaaaaaa-1111-2222-3333-444444444444',
    verb: 'Updated',
    actor: 'You',
    actorUserId: 'user-1',
    isToday: true,
    fields: [
      { key: 'on_hand', before: '5', after: '12', kind: 'changed' },
      { key: 'in_transit', before: '0', after: '8', kind: 'changed' },
    ],
  },
  {
    id: '2',
    occurredAt: '2026-06-18T09:00:00.000Z',
    action: 'purchase_orders.insert',
    entityType: 'purchase_orders',
    entityLabel: 'Purchase order',
    entityId: 'bbbbbbbb-1111-2222-3333-444444444444',
    verb: 'Created',
    actor: 'Teammate',
    actorUserId: 'user-2',
    isToday: false,
    fields: [{ key: 'status', before: null, after: 'draft', kind: 'added' }],
  },
  {
    id: '1',
    occurredAt: '2026-06-17T12:00:00.000Z',
    action: 'suppliers.update',
    entityType: 'suppliers',
    entityLabel: 'Supplier',
    entityId: null,
    verb: 'Updated',
    actor: 'System',
    actorUserId: null,
    isToday: false,
    fields: [],
  },
];

function renderChain(overrides: Partial<AuditChainProps> = {}) {
  return render(
    <AuditChain
      events={events}
      entityTypes={['inventory_levels', 'purchase_orders', 'suppliers']}
      activeEntity="all"
      windowLabel="1 year"
      olderExists={true}
      capped={false}
      tier="starter"
      {...overrides}
    />,
  );
}

describe('audit chain — the vertical chain of events', () => {
  it('renders one link per change, as a chain', () => {
    const { getByTestId, getAllByTestId } = renderChain();
    expect(getByTestId('audit-chain')).toBeTruthy();
    expect(getAllByTestId('audit-entry')).toHaveLength(3);
  });

  it("marks today's entry with the filled node (you-are-here)", () => {
    const { getAllByTestId } = renderChain();
    const entries = getAllByTestId('audit-entry');
    const todayEntries = entries.filter((e) => e.getAttribute('data-today') === 'true');
    expect(todayEntries).toHaveLength(1);
    // The node on the spine carries the today marker too.
    const node = todayEntries[0]?.querySelector('[data-today="true"]');
    expect(node).toBeTruthy();
  });

  it('expands the before/after diff on click and collapses again', () => {
    const { getAllByTestId, getAllByText, queryByTestId, getByTestId } = renderChain();
    expect(queryByTestId('audit-diff')).toBeNull();

    // Click the today entry (Updated Stock level, the first link) to expand its
    // two changed fields.
    const firstLink = getAllByTestId('audit-entry')[0]?.querySelector('button');
    expect(firstLink).toBeTruthy();
    fireEvent.click(firstLink as HTMLElement);
    const diff = getByTestId('audit-diff');
    expect(diff.textContent).toContain('on_hand');
    expect(getAllByText('→').length).toBeGreaterThan(0); // changed-field arrow

    // Clicking again collapses it.
    fireEvent.click(firstLink as HTMLElement);
    expect(queryByTestId('audit-diff')).toBeNull();
  });

  it('shows the tier upgrade stub when older history is gated', () => {
    const { getByTestId } = renderChain();
    expect(getByTestId('audit-upgrade').textContent).toContain('1 year');
  });

  it('offers the CSV export of the hot window', () => {
    const { getByTestId } = renderChain();
    expect(getByTestId('audit-export').getAttribute('href')).toBe('/api/exports/audit/window.csv');
  });

  it('says so honestly when the window holds more than one page (no silent cap)', () => {
    const { queryByTestId, getByTestId, rerender } = renderChain({ capped: false });
    expect(queryByTestId('audit-capped')).toBeNull();
    rerender(
      <AuditChain
        events={events}
        entityTypes={['inventory_levels']}
        activeEntity="all"
        windowLabel="1 year"
        olderExists={false}
        capped={true}
        tier="starter"
      />,
    );
    expect(getByTestId('audit-capped').textContent).toContain('Download the CSV');
  });
});
