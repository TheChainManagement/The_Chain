// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WhatIfBench } from '@/app/(app)/inventory/policy/WhatIfBench';
import type { WhatIfInputs } from '@/lib/policy/whatif';

/**
 * Memorable-element artifact (Block 9, MASTER_PROMPT "visible craft" gate).
 *
 * FEATURES: "The what-if panel has three slider levers (service level, lead
 * time, supplier). Drag any one and the entire policy ribbon below it (DOS,
 * ROP, safety stock, recommended qty, stockout risk) updates in real time as
 * you scrub, each number ticking with a counter-roll."
 *
 * Drives the REAL WhatIfBench over a fixture: scrubbing the service-level
 * lever changes the ribbon (safety stock + ROP move with z), the NumberRoll
 * faces tick, the supplier lever re-aims the lead time, and — the acceptance
 * bar — scrubbing performs ZERO writes (the save action is never called until
 * the explicit Save).
 */

const saveMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as const);
vi.mock('@/app/(app)/inventory/policy/actions', () => ({
  savePolicyDefault: (...args: unknown[]) => saveMock(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const INPUTS: WhatIfInputs = {
  productId: 'p-1107',
  sku: 'RVB-1107',
  name: '1/2 in PVC Coupling',
  locationId: 'loc-1',
  locationName: 'Hammond DC',
  demand: { dailyMean: 4.99, dailySigma: 1.28 },
  serviceLevel: 0.97,
  position: 242,
  suppliers: [
    {
      supplierId: 's-atch',
      name: 'Atchafalaya Distributing',
      isPrimary: true,
      leadTimeDays: 9,
      leadSigmaDays: 0,
      leadTimeSource: 'supplier',
      moq: 48,
    },
    {
      supplierId: 's-verm',
      name: 'Vermilion Supply Co',
      isPrimary: false,
      leadTimeDays: 14,
      leadSigmaDays: 2.1,
      leadTimeSource: 'scorecard',
      moq: 12,
    },
  ],
  primarySupplierId: 's-atch',
  coverageDays: 56,
};

function ribbonValues(): string[] {
  return [...screen.getByTestId('policy-ribbon').querySelectorAll('[data-testid="number-roll"]')].map(
    (el) => el.textContent ?? '',
  );
}

describe('Policy what-if bench (memorable element)', () => {
  it('renders the three levers and the five-cell policy ribbon', () => {
    render(<WhatIfBench inputs={INPUTS} />);
    expect(screen.getByText('SERVICE LEVEL')).toBeTruthy();
    expect(screen.getByText('LEAD TIME')).toBeTruthy();
    expect(screen.getByText('SUPPLIER')).toBeTruthy();
    expect(ribbonValues()).toHaveLength(5);
  });

  it('scrubbing the service-level lever ripples the ribbon and ticks the roll', () => {
    render(<WhatIfBench inputs={INPUTS} />);
    const before = ribbonValues();

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0] as Element, { target: { value: '99.5' } });

    const after = ribbonValues();
    expect(after).not.toEqual(before);
    // Higher service level → bigger z → larger safety stock + reorder point.
    expect(Number.parseFloat(after[2] ?? '')).toBeGreaterThan(Number.parseFloat(before[2] ?? ''));
    expect(Number.parseFloat(after[1] ?? '')).toBeGreaterThan(Number.parseFloat(before[1] ?? ''));
    // The counter-roll is armed on the changed cells.
    expect(
      screen.getByTestId('policy-ribbon').querySelectorAll('[data-rolling]').length,
    ).toBeGreaterThan(0);
  });

  it('swapping the supplier lever re-aims the lead time (9d → 14d empirical)', () => {
    render(<WhatIfBench inputs={INPUTS} />);
    const before = ribbonValues();
    fireEvent.click(screen.getByRole('button', { name: /Vermilion Supply Co/ }));
    expect(screen.getByText(/14 days/)).toBeTruthy();
    expect(screen.getByText(/empirical/)).toBeTruthy();
    expect(ribbonValues()).not.toEqual(before);
  });

  it('scrubbing writes NOTHING — only the explicit Save calls the action', () => {
    render(<WhatIfBench inputs={INPUTS} />);
    const sliders = screen.getAllByRole('slider');
    for (const v of ['92', '95.5', '99']) {
      fireEvent.change(sliders[0] as Element, { target: { value: v } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Vermilion Supply Co/ }));
    expect(saveMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save as default' }));
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith({
      productId: 'p-1107',
      locationId: 'loc-1',
      serviceLevel: 0.99,
    });
  });

  it('Save stays disabled until the service level actually moves', () => {
    render(<WhatIfBench inputs={INPUTS} />);
    const save = screen.getByRole('button', { name: 'Save as default' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
