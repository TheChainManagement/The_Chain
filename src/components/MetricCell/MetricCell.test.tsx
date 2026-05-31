// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCell } from './MetricCell';

describe('MetricCell', () => {
  it('renders the label and value through StatNumber', () => {
    render(<MetricCell label="FILL RATE" value="94.7" unit="%" />);
    expect(screen.getByText('FILL RATE')).toBeInTheDocument();
    expect(screen.getByText('94.7')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders a delta with a direction arrow', () => {
    render(
      <MetricCell
        label="STOCKOUTS"
        value="3"
        delta={{ value: '2 fewer', direction: 'down' }}
        deltaTone="flow"
      />,
    );
    expect(screen.getByText('2 fewer')).toBeInTheDocument();
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('hides the delta while loading', () => {
    render(
      <MetricCell
        label="FILL RATE"
        value="94.7"
        loading
        delta={{ value: '+1.2', direction: 'up' }}
      />,
    );
    expect(screen.queryByText('+1.2')).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-loading')).toBeInTheDocument();
  });

  it('shows an error marker via StatNumber', () => {
    render(<MetricCell label="FILL RATE" value={null} error />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
