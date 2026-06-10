// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectPanel } from '@/app/(app)/integrations/quickbooks/ConnectPanel';
import { SyncChain, type SyncLink } from '@/app/(app)/integrations/quickbooks/SyncChain';

/**
 * Memorable-element artifact (Block 6, MASTER_PROMPT "visible craft" gate).
 *
 * The QBO connect screen's signature is the cobalt chain forming as a sync runs.
 * As of Wave 6.2b the connected "Run sync" is a durable import: it kicks
 * `runQboInitialSync` and polls `getQboSyncProgress` while the chain forms link
 * by link (CATALOG → SUPPLIERS → SALES), then links the operator straight into
 * the freshly imported catalog. This drives the REAL `ConnectPanel` through both
 * run paths — the sample preview (not-connected) AND the durable live sync
 * (connected) — asserting pre-connect (the shape it will earn) → post-sync
 * (links formed, written counts surfaced, import nav shown), plus a direct
 * `SyncChain` mid-sync ignite frame.
 *
 * The network is mocked (jsdom). A true Playwright 3-state capture is ticketed
 * (Playwright isn't wired in the repo). Lives in `_reviews/` per MASTER_PROMPT;
 * vitest.config includes the `_reviews` memorable-test glob so it runs in CI.
 */

const RESULT = { catalog: 5, suppliers: 4, ordered: 2, inTransit: 1, receipts: 3, sales: 3, errors: 0 };

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('@/app/(app)/integrations/actions', () => ({
  runQboSandboxSync: vi.fn(async () => ({ ok: true, live: false, result: RESULT })),
  runQboInitialSync: vi.fn(async () => ({ ok: true, trackingKey: 'tk-1' })),
  getQboSyncProgress: vi.fn(async () => ({ status: 'completed', counts: RESULT })),
  startQboConnect: vi.fn(),
  disconnectQbo: vi.fn(),
}));

const BASE = {
  realmId: '9341454816836171',
  lastSyncedAt: null,
  environment: 'sandbox',
  banner: null,
  pendingConflicts: 0,
};

describe('QBO connect — the chain forms as the sync runs (memorable element)', () => {
  afterEach(() => vi.clearAllMocks());

  it('not-connected: the sample preview ignites the chain to formed', async () => {
    render(<ConnectPanel {...BASE} connected={false} configured banner={null} />);

    expect(document.querySelectorAll('[data-state="pending"]')).toHaveLength(3);
    expect(document.querySelector('[data-state="active"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /preview with sample data/i }));
    // Wait for the chain to fully form (the timer-driven reveal lights all 3).
    await waitFor(
      () => expect(document.querySelectorAll('[data-state="done"]')).toHaveLength(3),
      { timeout: 5000 },
    );

    expect(screen.getByText('5 products')).toBeInTheDocument();
    expect(screen.getByText('4 vendors')).toBeInTheDocument();
    expect(screen.getByText('6 movements')).toBeInTheDocument();
  });

  it('connected: durable "Run sync" forms the chain AND links into the imported catalog', async () => {
    render(<ConnectPanel {...BASE} connected configured banner="connected" />);

    // Connected shell: status line + the live-sync CTA.
    expect(screen.getByText(/connected ·/i)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-state="pending"]')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /^run sync$/i }));
    // "Re-run sync" only appears on done — an unambiguous done marker.
    await waitFor(() => expect(screen.getByRole('button', { name: /re-run sync/i })).toBeInTheDocument(), {
      timeout: 5000,
    });

    expect(document.querySelectorAll('[data-state="done"]')).toHaveLength(3);
    expect(screen.getByText('5 products')).toBeInTheDocument();
    expect(screen.getByText('Catalog')).toBeInTheDocument();

    // The Wave 6.2b payoff: the data is written, and the panel routes to it.
    expect(screen.getByText(/imported into your catalog/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view inventory/i })).toHaveAttribute('href', '/inventory');
    expect(screen.getByRole('link', { name: /view suppliers/i })).toHaveAttribute('href', '/suppliers');
  });

  it('mid-sync frame: the active link ignites and a formed link connects cobalt', () => {
    const links: SyncLink[] = [
      { step: 'CATALOG', label: '5 products', state: 'done', when: 'synced' },
      { step: 'SUPPLIERS', label: '4 vendors', state: 'active' },
      { step: 'SALES', label: '6 movements', state: 'pending' },
    ];
    const { container } = render(<SyncChain links={links} />);

    const active = container.querySelector('[data-state="active"]');
    expect(active).toBeInTheDocument();
    expect(active?.querySelectorAll('span').length).toBeGreaterThan(2);
    expect(container.querySelector('[data-state="done"]')).toHaveAttribute('data-connector', 'cobalt');
  });
});
