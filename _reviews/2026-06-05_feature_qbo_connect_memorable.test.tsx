// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectPanel } from '@/app/(app)/integrations/quickbooks/ConnectPanel';
import { SyncChain, type SyncLink } from '@/app/(app)/integrations/quickbooks/SyncChain';

/**
 * Memorable-element artifact (Block 6, MASTER_PROMPT "visible craft" gate).
 *
 * The QBO connect screen's signature is the cobalt chain forming as the first
 * sync runs. This drives the REAL `ConnectPanel` through the three states the
 * spec's required artifact captures — pre-connect (the shape it will earn),
 * mid/post-sync (links igniting to formed) — with the sandbox action mocked, plus
 * a direct `SyncChain` mid-sync frame asserting the ignite + cobalt connector.
 *
 * Lives in `_reviews/` per MASTER_PROMPT; vitest.config includes the
 * `_reviews` memorable-test glob so it still runs in CI.
 */

vi.mock('@/app/(app)/integrations/actions', () => ({
  runQboSandboxSync: vi.fn(async () => ({
    ok: true,
    result: { catalog: 5, suppliers: 4, ordered: 2, inTransit: 1, receipts: 3, sales: 3, errors: 0 },
  })),
}));

describe('QBO connect — the chain forms as the sync runs (memorable element)', () => {
  afterEach(() => vi.clearAllMocks());

  it('drives ConnectPanel pre-connect → post-sync, igniting the chain to formed', async () => {
    render(<ConnectPanel />);

    // Pre-connect: the chain shows the shape it will earn — all three pending.
    expect(document.querySelectorAll('[data-state="pending"]')).toHaveLength(3);
    expect(document.querySelector('[data-state="active"]')).toBeNull();

    const button = screen.getByRole('button', { name: /run sandbox preview/i });
    fireEvent.click(button);

    // The reveal plays out on real timers; the "Preview complete" note marks the
    // done state (one render after the last link forms).
    await waitFor(() => expect(screen.getByText(/Preview complete/i)).toBeInTheDocument(), {
      timeout: 5000,
    });

    // Post-sync: every link formed, real adapter counts surfaced, CTA flips.
    expect(document.querySelectorAll('[data-state="done"]')).toHaveLength(3);
    expect(screen.getByText('4 vendors')).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();
    expect(screen.getByText(/catalog/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-run sandbox preview/i })).toBeInTheDocument();
  });

  it('mid-sync frame: the active link ignites and a formed link connects cobalt', () => {
    const links: SyncLink[] = [
      { step: 'SUPPLIERS', label: '4 vendors', state: 'done', when: 'synced' },
      { step: 'ORDERED', label: '2 orders', state: 'active' },
      { step: 'IN TRANSIT', label: '1 open', state: 'pending' },
    ];
    const { container } = render(<SyncChain links={links} />);

    const active = container.querySelector('[data-state="active"]');
    expect(active).toBeInTheDocument();
    expect(active?.querySelectorAll('span').length).toBeGreaterThan(2); // the ignite sweep
    expect(container.querySelector('[data-state="done"]')).toHaveAttribute('data-connector', 'cobalt');
  });
});
