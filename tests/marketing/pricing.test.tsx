// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));

const { default: Pricing } = await import('@/app/(marketing)/pricing/page');

describe('pricing — hairline tiers', () => {
  it('renders four tiers with the draft prices and retention windows', () => {
    const { getAllByTestId, getByText } = render(<Pricing />);
    const tiers = getAllByTestId('tier');
    expect(tiers).toHaveLength(4);
    expect(tiers.map((t) => t.querySelector('h2')?.textContent)).toEqual([
      'Starter',
      'Growth',
      'Pro',
      'Enterprise',
    ]);
    // Prices render via StatNumber (tabular mono).
    for (const price of ['129', '299', '599']) expect(getByText(price)).toBeTruthy();
    expect(getByText('Custom')).toBeTruthy();
    // Retention windows map to the audit retention tiers.
    for (const win of ['1 year', '5 years', '10 years', 'Unlimited']) {
      expect(getByText(win)).toBeTruthy();
    }
  });

  it('renders a dedicated retention compare-table across all plans', () => {
    const { getByTestId } = render(<Pricing />);
    const compare = getByTestId('retention-compare');
    const text = compare.textContent ?? '';
    for (const v of ['1 year', '5 years', '10 years', 'Unlimited']) expect(text).toContain(v);
  });

  it('marks Growth as popular, routes paid tiers to sign-up, Enterprise to contact', () => {
    const { getAllByTestId, getAllByRole, getByRole } = render(<Pricing />);
    const popular = getAllByTestId('tier').filter((t) => t.getAttribute('data-popular') === 'true');
    expect(popular).toHaveLength(1);
    expect(popular[0]?.querySelector('h2')?.textContent).toBe('Growth');
    // Hard paywall: 3 paid-tier CTAs + the closing ChainCtaBand CTA = 4, all to sign-up.
    const ctas = getAllByRole('link', { name: /get started/i });
    expect(ctas).toHaveLength(4);
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/signup');
    // Enterprise is contact-only, not self-serve checkout.
    expect(getByRole('link', { name: /contact us/i }).getAttribute('href')).toBe('/contact');
  });
});
