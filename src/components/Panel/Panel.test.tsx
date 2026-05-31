// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders a header with prefix and title', () => {
    render(
      <Panel prefix="REORDER QUEUE" title="Needs attention">
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByText('REORDER QUEUE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
  });

  it('renders children in the body by default', () => {
    render(
      <Panel title="Inventory">
        <span>147 SKUs</span>
      </Panel>,
    );
    expect(screen.getByText('147 SKUs')).toBeInTheDocument();
  });

  it('renders the empty state with a message', () => {
    render(<Panel title="Alerts" empty emptyMessage="No open alerts." />);
    expect(screen.getByTestId('panel-empty')).toBeInTheDocument();
    expect(screen.getByText('No open alerts.')).toBeInTheDocument();
  });

  it('renders a loading skeleton', () => {
    render(<Panel title="Forecasts" loading />);
    expect(screen.getByTestId('panel-loading')).toBeInTheDocument();
  });

  it('renders an error alert', () => {
    render(<Panel title="Suppliers" error errorMessage="Sync failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sync failed.');
  });

  it('renders header actions', () => {
    render(<Panel title="POs" actions={<button type="button">New</button>} />);
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});
