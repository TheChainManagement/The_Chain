// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));

const { default: About } = await import('@/app/(marketing)/about/page');
const { default: Contact } = await import('@/app/(marketing)/contact/page');

describe('about page', () => {
  it('tells the why and routes to the trial', () => {
    const { getByRole, getByText } = render(<About />);
    expect(getByRole('heading', { level: 1 }).textContent).toContain('big operators');
    expect(getByText(/built by/i).textContent).toContain('More Technologies');
    expect(getByRole('link', { name: /get started/i }).getAttribute('href')).toBe('/signup');
  });
});

describe('contact page', () => {
  it('offers an email channel and the trial CTA', () => {
    const { getByRole, getAllByRole } = render(<Contact />);
    expect(getByRole('heading', { level: 1 }).textContent).toContain('Let');
    const mailtos = getAllByRole('link').filter((a) =>
      a.getAttribute('href')?.startsWith('mailto:'),
    );
    expect(mailtos.length).toBeGreaterThan(0);
    expect(mailtos[0]?.getAttribute('href')).toContain('@moretechnologies.com');
    expect(getByRole('link', { name: /get started/i }).getAttribute('href')).toBe('/signup');
  });
});
