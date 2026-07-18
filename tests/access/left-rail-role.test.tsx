// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Role-aware bench chrome (W3-2, memorable artifact). The visible delta: two
 * people in the SAME tenant and mode see different rails. A planner loses the
 * owner-only surfaces (Integrations, Settings); a warehouse role collapses to
 * physical flow (Inventory, Transfers) and loses planning/procurement. The rail
 * also stamps the member's role by their identity. Nav hiding is chrome — the
 * server guards are the real boundary — but the wrong rail is a visible
 * regression, so it is pinned here in CI.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(auth)/actions', () => ({ signOut: vi.fn() }));

const { LeftRail } = await import('@/components/bench/LeftRail');
const { getProfile } = await import('@/lib/modes/profiles');

// Same tenant, same mode — role is the only variable.
const distribution = getProfile('distribution');

describe('LeftRail hides nav and stamps identity by member role', () => {
  it('owner sees the full rail and an OWNER badge', () => {
    const { getByRole, getByText } = render(
      <LeftRail userEmail="owner@thechain.test" role="owner" profile={distribution} />,
    );
    expect(getByRole('link', { name: 'Integrations' })).toBeInTheDocument();
    expect(getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(getByText('Owner')).toBeInTheDocument();
  });

  it('planner loses Integrations and Settings, keeps planning surfaces', () => {
    const { getByRole, queryByRole, getByText } = render(
      <LeftRail userEmail="planner@thechain.test" role="planner" profile={distribution} />,
    );
    expect(queryByRole('link', { name: 'Integrations' })).toBeNull();
    expect(queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(getByRole('link', { name: 'Forecasts' })).toBeInTheDocument();
    expect(getByRole('link', { name: 'Procurement' })).toBeInTheDocument();
    expect(getByText('Planner')).toBeInTheDocument();
  });

  it('warehouse collapses to physical flow only', () => {
    const { getByRole, queryByRole, getByText } = render(
      <LeftRail userEmail="wh@thechain.test" role="warehouse" profile={distribution} />,
    );
    expect(getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(getByRole('link', { name: 'Transfers' })).toBeInTheDocument();
    for (const hidden of ['Forecasts', 'Suppliers', 'Procurement', 'Reorder', 'Settings']) {
      expect(queryByRole('link', { name: hidden })).toBeNull();
    }
    expect(getByText('Warehouse')).toBeInTheDocument();
  });

  it('viewer keeps read-only operating nav but no Settings or Integrations', () => {
    const { getByRole, queryByRole, getByText } = render(
      <LeftRail userEmail="viewer@thechain.test" role="viewer" profile={distribution} />,
    );
    expect(getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(queryByRole('link', { name: 'Integrations' })).toBeNull();
    expect(getByText('Viewer')).toBeInTheDocument();
  });
});
