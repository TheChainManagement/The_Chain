// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { default: MarketingHome } = await import('@/app/(marketing)/page');
const { default: MarketingLayout } = await import('@/app/(marketing)/layout');

describe('SEO + footer wiring', () => {
  it('emits valid SoftwareApplication JSON-LD on the home page', () => {
    const { container } = render(<MarketingHome />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const data = JSON.parse(script?.textContent ?? '{}');
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.name).toBe('The Chain');
    expect(data.offers?.price).toBe('129');
  });

  it('links every marketing page from the footer', () => {
    const { container } = render(
      <MarketingLayout>
        <div />
      </MarketingLayout>,
    );
    const footerLinks = [...container.querySelectorAll('footer nav a')].map((a) =>
      a.getAttribute('href'),
    );
    for (const href of ['/how-it-works', '/pricing', '/about', '/contact']) {
      expect(footerLinks).toContain(href);
    }
  });
});
