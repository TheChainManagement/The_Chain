// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Memorable-artifact guard for the marketing hero (Block 17a). The hero visual is
 * intentionally deferred ("work on this further down"); the deliberate choice that
 * keeps the page from reading as a flat white screen is the faded engineering
 * blueprint behind a clean, confident opening — the slogan, the why, the CTA.
 * Paired with the live capture in `_reviews/2026-06-20_block17a-marketing-hero.md`.
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
