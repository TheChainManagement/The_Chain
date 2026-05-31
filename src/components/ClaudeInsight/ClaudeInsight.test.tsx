// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClaudeInsight } from './ClaudeInsight';

describe('ClaudeInsight', () => {
  it('renders the Claude prefix with the topic', () => {
    render(<ClaudeInsight topic="reorder">Reorder now to avoid a stockout.</ClaudeInsight>);
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('reorder')).toBeInTheDocument();
  });

  it('renders the interpretation prose', () => {
    render(<ClaudeInsight topic="forecast">Demand is trending up 12% this quarter.</ClaudeInsight>);
    expect(screen.getByText('Demand is trending up 12% this quarter.')).toBeInTheDocument();
  });

  it('renders a confidence track with a percentage', () => {
    render(
      <ClaudeInsight topic="forecast" confidence={0.82}>
        Steady demand.
      </ClaudeInsight>,
    );
    expect(screen.getByTestId('insight-confidence')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('CONFIDENCE')).toBeInTheDocument();
  });

  it('shows a loading skeleton', () => {
    render(<ClaudeInsight topic="reorder" loading />);
    expect(screen.getByTestId('insight-loading')).toBeInTheDocument();
  });

  it('shows an error fallback that defers to the numbers', () => {
    render(<ClaudeInsight topic="reorder" error />);
    expect(screen.getByRole('status')).toHaveTextContent('numbers above still stand');
  });

  it('shows an empty state when no children', () => {
    render(<ClaudeInsight topic="reorder" />);
    expect(screen.getByText('No interpretation yet.')).toBeInTheDocument();
  });
});
