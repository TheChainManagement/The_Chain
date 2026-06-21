// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
  initAnalytics: vi.fn(),
  capturePageview: vi.fn(),
}));

const { default: HowItWorks } = await import('@/app/(marketing)/how-it-works/page');

describe('how it works — the four-stage chain', () => {
  it('renders the four stages in order', () => {
    const { getAllByTestId } = render(<HowItWorks />);
    const stages = getAllByTestId('stage');
    expect(stages).toHaveLength(4);
    const names = stages.map((s) => s.querySelector('h2')?.textContent);
    expect(names).toEqual(['Connect', 'Forecast', 'Reorder', 'Receive']);
  });

  it('leads with the chain headline and a trial CTA', () => {
    const { getByRole } = render(<HowItWorks />);
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Four links. One chain.');
    expect(getByRole('link', { name: /start 14-day trial/i }).getAttribute('href')).toBe('/signup');
  });

  it('mounts the guided workbench with Connect active and a per-stage metric', () => {
    const { container, getAllByTestId } = render(<HowItWorks />);
    const stages = getAllByTestId('stage');
    // Each stage is index-tagged for the IntersectionObserver flow.
    expect(stages.map((s) => s.getAttribute('data-idx'))).toEqual(['0', '1', '2', '3']);
    // Default active stage is the first one (Connect) before any scroll.
    expect(stages[0]?.getAttribute('data-active')).toBe('true');
    // The sticky visual caption reflects the active stage + its metric.
    const caption = container.querySelector('figcaption');
    expect(caption?.textContent).toContain('Connect');
    expect(caption?.textContent).toContain('15 min');
  });
});
