// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatNumber } from './StatNumber';

describe('StatNumber', () => {
  it('renders the value verbatim without rounding', () => {
    render(<StatNumber value="47.2" unit="%" />);
    expect(screen.getByText('47.2')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders a prefix unit before the digits', () => {
    render(<StatNumber value="1,247.20" unit="$" unitPosition="prefix" />);
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('1,247.20')).toBeInTheDocument();
  });

  it('shows an em-dash empty marker when value is null', () => {
    render(<StatNumber value={null} aria-label="no reorder point yet" />);
    expect(screen.getByLabelText('no reorder point yet')).toHaveTextContent('—');
  });

  it('shows a loading shimmer placeholder', () => {
    render(<StatNumber value={42} loading />);
    expect(screen.getByTestId('stat-loading')).toBeInTheDocument();
  });

  it('shows a stop-red marker on error', () => {
    render(<StatNumber value={42} error aria-label="forecast failed" />);
    expect(screen.getByLabelText('forecast failed')).toHaveTextContent('—');
  });

  it('renders an optional mono caps label', () => {
    render(<StatNumber value="8.3" unit="days" label="LEAD TIME" />);
    expect(screen.getByText('LEAD TIME')).toBeInTheDocument();
  });
});
