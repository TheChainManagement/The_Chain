// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Route-segment separation (Block 17a, FEATURES acceptance). The (marketing)
 * layout must NOT inherit the (app) bench: no left rail, no right rail, no app
 * navigation. It shares design tokens, never layout chrome. This renders the
 * real MarketingLayout and asserts the editorial chrome is present and the bench
 * chrome is absent.
 */

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { default: MarketingLayout } = await import('@/app/(marketing)/layout');

describe('marketing segment does not inherit the bench', () => {
  it('renders the editorial top bar + footer, not bench rails', () => {
    const { getByText, getAllByText, queryByText, container } = render(
      <MarketingLayout>
        <div data-testid="child">page</div>
      </MarketingLayout>,
    );

    // Editorial chrome present.
    expect(getAllByText('The Chain').length).toBeGreaterThan(0);
    expect(getByText(/start 14-day trial/i)).toBeTruthy();
    expect(getByText(/© 2026 more technologies/i)).toBeTruthy();

    // Bench chrome absent — none of the app rail nav items leak onto marketing.
    for (const benchItem of ['Forecasts', 'Reorder', 'Purchase Orders', 'Integrations', 'Today']) {
      expect(queryByText(benchItem)).toBeNull();
    }
    // No app primary nav region (the bench LeftRail uses aria-label="Primary"
    // on a <nav> containing rail items); marketing's <nav> carries only the CTA.
    const primaryNavs = container.querySelectorAll('nav[aria-label="Primary"]');
    for (const nav of primaryNavs) {
      expect(nav.textContent).not.toContain('Inventory');
    }
  });

  it('renders its children', () => {
    const { getByTestId } = render(
      <MarketingLayout>
        <div data-testid="child">page</div>
      </MarketingLayout>,
    );
    expect(getByTestId('child')).toBeTruthy();
  });
});
