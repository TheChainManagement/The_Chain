// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShardFleet } from '@/app/(app)/forecasts/ForecastBatchControls';

/**
 * Memorable-element artifact (Block 8 Wave 2b, MASTER_PROMPT "visible craft"
 * gate).
 *
 * The forecasts cockpit's signature this wave is the SHARD FLEET: the durable
 * batch renders as a row of shard tiles that fill left-to-right as coverage
 * lands, so one glance reads how much of the catalog has a fresh forecast.
 * (The forecast chart — the block's centerpiece — is wave 2c; this artifact
 * covers the batch's visible element.) Renders the real `ShardFleet` at three
 * coverage states and asserts the fill progression + the accessible
 * progressbar contract.
 */

function fills(): string[] {
  return Array.from(
    screen.getByTestId('shard-fleet').querySelectorAll('[data-fill]'),
    (el) => el.getAttribute('data-fill') ?? '',
  );
}

describe('Forecast shard fleet (memorable element)', () => {
  it('renders one tile per shard, all empty before coverage lands', () => {
    render(<ShardFleet processed={0} total={1000} shards={5} />);
    const states = fills();
    expect(states).toHaveLength(5);
    expect(states.every((s) => s === 'empty')).toBe(true);
  });

  it('fills left-to-right as coverage lands, with a partial leading edge', () => {
    render(<ShardFleet processed={500} total={1000} shards={5} />);
    const states = fills();
    expect(states.slice(0, 2)).toEqual(['full', 'full']);
    expect(states[2]).toBe('partial');
    expect(states.slice(3)).toEqual(['empty', 'empty']);
  });

  it('reads fully lit at complete coverage', () => {
    render(<ShardFleet processed={1000} total={1000} shards={5} />);
    expect(fills().every((s) => s === 'full')).toBe(true);
  });

  it('exposes the accessible progressbar contract with the SKU count', () => {
    render(<ShardFleet processed={840} total={1247} shards={7} />);
    const bar = screen.getByRole('progressbar', { name: /forecast batch progress/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('840');
    expect(bar.getAttribute('aria-valuemax')).toBe('1247');
    expect(screen.getByText('840/1247 SKUs')).toBeTruthy();
  });

  it('caps the ribbon at 40 tiles so a 50k-SKU tenant still reads as a ribbon', () => {
    render(<ShardFleet processed={10000} total={50000} shards={250} />);
    expect(fills()).toHaveLength(40);
  });
});
