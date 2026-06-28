// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Operating-mode rail (W2-0, memorable artifact). The visible delta: when a
 * tenant's mode changes, the rail shows a mode badge and refits the inventory
 * nav term to that industry. Distribution is the Wave-1 baseline ("Inventory");
 * a storeroom calls it the "Storeroom"; food service calls it "Stock". Proven
 * here in CI so the relabel can't silently regress.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/today' }));
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }));

const { LeftRail } = await import('@/components/bench/LeftRail');

describe('LeftRail fits nav + badge to the operating mode', () => {
  it('distribution: baseline inventory link + "demand from sales"', () => {
    const { getByRole, queryByRole, getByLabelText, getByText } = render(
      <LeftRail userEmail="op@thechain.test" mode="distribution" />,
    );
    expect(getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(queryByRole('link', { name: 'Storeroom' })).toBeNull();
    expect(getByLabelText('Operating mode: Distribution')).toBeInTheDocument();
    expect(getByText('demand from sales')).toBeInTheDocument();
  });

  it('storeroom: inventory link becomes "Storeroom" + "demand from issues"', () => {
    const { getByRole, queryByRole, getByLabelText, getByText } = render(
      <LeftRail userEmail="op@thechain.test" mode="storeroom" />,
    );
    // The /inventory slot is renamed in place — the baseline link is gone.
    expect(getByRole('link', { name: 'Storeroom' })).toBeInTheDocument();
    expect(queryByRole('link', { name: 'Inventory' })).toBeNull();
    expect(getByLabelText('Operating mode: Storeroom')).toBeInTheDocument();
    expect(getByText('demand from issues')).toBeInTheDocument();
  });

  it('food: inventory link becomes "Stock" + "demand from usage"', () => {
    const { getByRole, queryByRole, getByLabelText, getByText } = render(
      <LeftRail userEmail="op@thechain.test" mode="food" />,
    );
    expect(getByRole('link', { name: 'Stock' })).toBeInTheDocument();
    expect(queryByRole('link', { name: 'Inventory' })).toBeNull();
    expect(getByLabelText('Operating mode: Food service')).toBeInTheDocument();
    expect(getByText('demand from usage')).toBeInTheDocument();
  });
});
