// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictCockpit } from '@/app/(app)/flow/sync-conflicts/ConflictCockpit';
import type { PendingConflict } from '@/lib/qbo/conflicts';

/**
 * Memorable-element artifact (Block 6 Wave 6.3-C, MASTER_PROMPT "visible craft" gate).
 *
 * The sync-conflict cockpit's signature is the reconciliation bench: two diverged
 * columns (YOUR RECORD vs QUICKBOOKS) that the operator resolves field by field,
 * the chosen value lighting cobalt (the single intent slot), then converging into
 * one settled cobalt chain link (RECONCILED). This drives the REAL `ConflictCockpit`
 * through that flow — diff visible → merge mode makes differing cells pickable →
 * choosing flips the cobalt selection → resolve plays the reconcile beat — and
 * asserts the Server Action is called with the operator's per-field merge payload.
 *
 * The action is mocked (jsdom). The reproducible visual lives at /gallery; this
 * test is the on-disk CI artifact. Lives in `_reviews/` per MASTER_PROMPT; the
 * vitest config includes the `_reviews` memorable-test glob so it runs in CI.
 */

const resolveSyncConflict = vi.fn(async () => ({ ok: true as const }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(app)/flow/sync-conflicts/actions', () => ({
  resolveSyncConflict: (...args: unknown[]) => resolveSyncConflict(...(args as [])),
}));

const PRODUCT: PendingConflict = {
  id: 'fx-product',
  entityType: 'product',
  entityId: 'fx-1',
  externalRef: 'QBO:1042',
  title: 'Galvanized Joist Hanger 2x10',
  subtitle: 'SKU-2231',
  policyDecision: 'needs_review',
  createdAt: '2026-06-10T13:02:00.000Z',
  localState: {
    name: 'Galv Joist Hanger 2x10',
    description: '18-gauge, triple-zinc',
    unitOfMeasure: 'ea',
    status: 'active',
  },
  remoteState: {
    name: 'Galvanized Joist Hanger 2x10',
    description: '18-gauge, triple-zinc',
    unitOfMeasure: 'box of 25',
    status: 'active',
  },
  fields: [
    {
      key: 'name',
      label: 'Name',
      local: 'Galv Joist Hanger 2x10',
      remote: 'Galvanized Joist Hanger 2x10',
      differs: true,
    },
    {
      key: 'description',
      label: 'Description',
      local: '18-gauge, triple-zinc',
      remote: '18-gauge, triple-zinc',
      differs: false,
    },
    {
      key: 'unitOfMeasure',
      label: 'Unit of measure',
      local: 'ea',
      remote: 'box of 25',
      differs: true,
    },
    { key: 'status', label: 'Status', local: 'active', remote: 'active', differs: false },
  ],
};

describe('Sync-conflict cockpit — reconciliation bench (memorable element)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the diff, only the differing cells are pickable, and non-differing cells never light cobalt', () => {
    render(<ConflictCockpit conflicts={[PRODUCT]} />);

    // The two diverged columns are present and the diff is summarised.
    expect(screen.getByText('Your record')).toBeTruthy();
    expect(screen.getByText('QuickBooks')).toBeTruthy();
    expect(screen.getByText(/2 fields differ/i)).toBeTruthy();

    // Before merge mode, no cell is pickable.
    expect(document.querySelector('[data-pickable="true"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Merge$/i }));

    // Only the two differing fields (name, unit) become pickable — 4 cells.
    expect(document.querySelectorAll('[data-pickable="true"]')).toHaveLength(4);
    // The non-differing description cells (identical text on both sides) stay
    // disabled and never "chosen" — the cobalt selection is reserved for real diffs.
    const descriptionCells = screen.getAllByRole('button', {
      name: '18-gauge, triple-zinc',
    }) as HTMLButtonElement[];
    expect(descriptionCells).toHaveLength(2);
    for (const cell of descriptionCells) {
      expect(cell.disabled).toBe(true);
      expect(cell.getAttribute('data-chosen')).toBeNull();
    }
  });

  it('flips the cobalt selection on pick and plays the reconcile beat with the merge payload', async () => {
    render(<ConflictCockpit conflicts={[PRODUCT]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Merge$/i }));

    // Default pick is local; the local unit cell carries the cobalt "chosen" flag.
    const localUnit = screen.getByRole('button', { name: 'ea' });
    expect(localUnit.getAttribute('data-chosen')).toBe('true');

    // Take QuickBooks for the unit + name; the remote cells now own the selection.
    const remoteUnit = screen.getByRole('button', { name: 'box of 25' });
    const remoteName = screen.getByRole('button', { name: 'Galvanized Joist Hanger 2x10' });
    fireEvent.click(remoteUnit);
    fireEvent.click(remoteName);
    expect(remoteUnit.getAttribute('data-chosen')).toBe('true');
    expect(localUnit.getAttribute('data-chosen')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /save merge/i }));

    // The action gets the object-arg shape with the operator's per-field blend:
    // remote name + remote unit, local description + status.
    await waitFor(() => expect(resolveSyncConflict).toHaveBeenCalledTimes(1));
    expect(resolveSyncConflict).toHaveBeenCalledWith({
      conflictId: 'fx-product',
      resolution: 'merge',
      mergePayload: {
        name: 'Galvanized Joist Hanger 2x10',
        description: '18-gauge, triple-zinc',
        unitOfMeasure: 'box of 25',
        status: 'active',
      },
    });

    // The reconcile beat renders the settled chain link.
    await waitFor(() => expect(screen.getByText('RECONCILED')).toBeTruthy());
    expect(screen.getByText('Merged field by field')).toBeTruthy();
  });
});
