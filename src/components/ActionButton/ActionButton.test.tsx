// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionButton } from './ActionButton';

describe('ActionButton', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<ActionButton onClick={onClick}>Approve PO</ActionButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Approve PO' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables interaction and shows a tick while loading', async () => {
    const onClick = vi.fn();
    render(
      <ActionButton onClick={onClick} loading>
        Approve PO
      </ActionButton>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('button-loading')).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respects an explicit disabled prop', () => {
    render(<ActionButton disabled>Export</ActionButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders a secondary variant', () => {
    render(<ActionButton variant="secondary">Cancel</ActionButton>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('defaults to type=button to avoid accidental form submits', () => {
    render(<ActionButton>Save</ActionButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
