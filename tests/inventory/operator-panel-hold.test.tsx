// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OperatorPanel hold mode (W2-2.5). The interaction contract: a Hold/Release
 * segmented toggle, positive quantity, hold-only reason select (release posts
 * the fixed 'release' code with the select hidden), a mono readout of the
 * returned level after posting, and idempotency-key rotation between posts so
 * the panel can post repeatedly without replaying as a no-op.
 */

const holdStock = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/inventory/storeroom-actions', () => ({
  holdStock,
  adjustStock: vi.fn(),
  issueStock: vi.fn(),
}));

import { OperatorPanel } from '@/app/(app)/inventory/OperatorPanel';
import type { InventoryListRow } from '@/lib/inventory/queries';

const row: InventoryListRow = {
  id: 'p1',
  sku: 'SKU-1',
  name: 'Widget',
  status: 'active',
  unitOfMeasure: 'ea',
  onHand: 10,
  onHold: 0,
  allocated: 0,
  inTransit: 0,
  totalValue: null,
  abcClass: null,
  xyzClass: null,
};

function renderHold(): { onDone: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <OperatorPanel
      mode="hold"
      rows={[row]}
      locationId="loc1"
      onDone={onDone}
      onCancel={onCancel}
    />,
  );
  return { onDone, onCancel };
}

function calledKeys(): (string | undefined)[] {
  return holdStock.mock.calls.map(
    (call) => (call[0] as { idempotencyKey: string } | undefined)?.idempotencyKey,
  );
}

beforeEach(() => {
  holdStock.mockReset();
  holdStock.mockResolvedValue({ ok: true, onHand: 10, onHold: 4 });
});

describe('OperatorPanel hold mode', () => {
  it('posts a hold with the picked reason and shows the returned level', async () => {
    renderHold();
    await userEvent.type(screen.getByLabelText('Quantity'), '4');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'qc_hold');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));

    expect(holdStock).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'p1',
        locationId: 'loc1',
        movement: 'hold',
        qty: 4,
        reasonCode: 'qc_hold',
        idempotencyKey: expect.any(String),
      }),
    );
    // Readout: 'On hand 10 · Held 4' rendered through StatNumber (mono).
    const readout = await screen.findByLabelText('Level after posting');
    expect(readout).toHaveTextContent('On hand 10 · Held 4');
  });

  it('hides the reason select on release and posts the fixed release reason', async () => {
    renderHold();
    await userEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(screen.queryByLabelText('Reason')).toBeNull();

    await userEvent.type(screen.getByLabelText('Quantity'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Release stock' }));

    expect(holdStock).toHaveBeenCalledWith(
      expect.objectContaining({ movement: 'release', reasonCode: 'release' }),
    );
  });

  it('blocks a non-positive quantity and a missing hold reason before the action', async () => {
    renderHold();
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a quantity greater than zero.');

    await userEvent.type(screen.getByLabelText('Quantity'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a reason for the hold.');
    expect(holdStock).not.toHaveBeenCalled();
  });

  it('rotates the idempotency key after a successful post', async () => {
    renderHold();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'damage_hold');
    await userEvent.type(screen.getByLabelText('Quantity'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));
    await screen.findByLabelText('Level after posting');

    await userEvent.type(screen.getByLabelText('Quantity'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));

    expect(holdStock).toHaveBeenCalledTimes(2);
    const [first, second] = calledKeys();
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('renders the action error in the error slot and keeps the key stable', async () => {
    holdStock.mockResolvedValue({
      ok: false,
      error: 'Not enough unheld stock at this location to hold that quantity.',
    });
    renderHold();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'qc_hold');
    await userEvent.type(screen.getByLabelText('Quantity'), '99');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not enough unheld stock at this location to hold that quantity.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));
    expect(holdStock).toHaveBeenCalledTimes(2);
    const [first, second] = calledKeys();
    expect(first).toBeDefined();
    expect(first).toBe(second); // a failed post replays, it does not mint a new event
  });

  it('offers Done after a post (refresh path) and Cancel before', async () => {
    const { onDone, onCancel } = renderHold();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'qc_hold');
    await userEvent.type(screen.getByLabelText('Quantity'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Hold stock' }));
    await screen.findByLabelText('Level after posting');

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});
