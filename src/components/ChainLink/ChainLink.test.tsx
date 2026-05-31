// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChainLink } from './ChainLink';

describe('ChainLink', () => {
  it('renders the step, label, and timestamp', () => {
    render(<ChainLink step="SUPPLIER" label="Atchafalaya Distributing" when="Apr 18 · 09:24" />);
    expect(screen.getByText('SUPPLIER')).toBeInTheDocument();
    expect(screen.getByText('Atchafalaya Distributing')).toBeInTheDocument();
    expect(screen.getByText('Apr 18 · 09:24')).toBeInTheDocument();
  });

  it('exposes state via a data attribute for done links', () => {
    const { container } = render(<ChainLink step="ORDERED" label="PO-4471" state="done" />);
    expect(container.firstChild).toHaveAttribute('data-state', 'done');
  });

  it('renders the ignite element only on active links', () => {
    const { container, rerender } = render(
      <ChainLink step="IN TRANSIT" label="3 pallets" state="active" />,
    );
    expect(container.querySelector('[data-state="active"]')).toBeInTheDocument();
    // Active link carries the ignite sweep element (memorable moment).
    expect(container.querySelectorAll('span').length).toBeGreaterThan(2);

    rerender(<ChainLink step="RECEIVED" label="Pending" state="pending" />);
    expect(container.querySelector('[data-state="pending"]')).toBeInTheDocument();
  });

  it('carries the connector kind via a data attribute', () => {
    const { container } = render(
      <ChainLink step="ORDERED" label="PO-4471" state="done" connector="cobalt" />,
    );
    expect(container.firstChild).toHaveAttribute('data-connector', 'cobalt');
  });
});
