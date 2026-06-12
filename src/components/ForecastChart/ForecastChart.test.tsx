// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ForecastChart } from './ForecastChart';

const history = [
  { ds: '2026-05-07', y: 12 },
  { ds: '2026-05-14', y: 15 },
  { ds: '2026-05-21', y: 11 },
  { ds: '2026-05-28', y: 14 },
];

const points = [
  { ds: '2026-06-18', mean: 13.4, lo95: 9.1, hi95: 17.8, lo80: 10.8, hi80: 16.1 },
  { ds: '2026-06-25', mean: 13.7, lo95: 8.2, hi95: 19.3, lo80: 10.1, hi80: 17.4 },
];

describe('ForecastChart — structure', () => {
  it('renders one square marker per history week', () => {
    render(<ForecastChart history={history} points={points} label="test chart" />);
    expect(screen.getAllByTestId('history-dot')).toHaveLength(4);
  });

  it('renders both bands and a mean per forecast week', () => {
    render(<ForecastChart history={history} points={points} label="test chart" />);
    expect(screen.getAllByTestId('band-95')).toHaveLength(2);
    expect(screen.getAllByTestId('band-80')).toHaveLength(2);
    expect(screen.getAllByTestId('forecast-mean')).toHaveLength(2);
  });

  it('omits bands for benchmark fills (null bounds) but keeps the means', () => {
    const benchmark = [
      { ds: '2026-06-18', mean: 9.4, lo95: null, hi95: null, lo80: null, hi80: null },
    ];
    render(<ForecastChart history={history} points={benchmark} label="benchmark chart" />);
    expect(screen.queryAllByTestId('band-95')).toHaveLength(0);
    expect(screen.getAllByTestId('forecast-mean')).toHaveLength(1);
  });

  it('renders nothing for a SKU with no data at all', () => {
    const { container } = render(<ForecastChart history={[]} points={[]} label="empty" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('is an accessible image with the provided label', () => {
    render(<ForecastChart history={history} points={points} label="RVB-1107 forecast" />);
    expect(screen.getByRole('img', { name: 'RVB-1107 forecast' })).toBeTruthy();
  });
});
