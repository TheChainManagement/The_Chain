// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Memorable-artifact guard for the marketing hero. Re-cut 2026-06-21
 * (build-beautiful): the isometric supply-chain model is now composited onto the
 * drafting bench with mix-blend over a rotated engineering blueprint, the
 * headline stamps in on the Mona Sans width axis, and the live PO chain ignites
 * cobalt at the PO link. This guard holds the load-bearing invariants: the slogan
 * is the H1, the trial CTA points at sign-up, and the blueprint underlay still
 * renders (hero-bg) so the page is never a flat white screen.
 * Paired with the live capture in `_reviews/2026-06-21_feature_marketing.md`.
 */

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));

const { default: MarketingHome } = await import('@/app/(marketing)/page');

describe('marketing hero — everything is connected', () => {
  it('leads with the slogan and the trial CTA', () => {
    const { getByRole } = render(<MarketingHome />);
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Everything is connected.');
    expect(getByRole('link', { name: /start 14-day trial/i }).getAttribute('href')).toBe('/signup');
  });

  it('renders the faded blueprint background (never a flat white screen)', () => {
    const { getByTestId } = render(<MarketingHome />);
    expect(getByTestId('hero-bg')).toBeTruthy();
  });
});
