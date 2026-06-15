import { describe, expect, it } from 'vitest';
import { derivePolicy } from '@/lib/policy/compute';
import { deriveScenario, type WhatIfInputs } from '@/lib/policy/whatif';

/**
 * `deriveScenario` is the single source of truth for the bench's instant ripple
 * AND the server-side what-if insight facts (Block 12 Wave B3). It must produce
 * exactly what a direct `derivePolicy` call would, so the two surfaces never drift.
 */
const INPUTS: WhatIfInputs = {
  productId: 'p1',
  sku: 'BLT-200',
  name: 'Bolt',
  locationId: 'loc1',
  locationName: 'Main',
  demand: { dailyMean: 5, dailySigma: 2 },
  serviceLevel: 0.95,
  position: 40,
  coverageDays: 14,
  primarySupplierId: 's1',
  suppliers: [
    {
      supplierId: 's1',
      name: 'Atchafalaya',
      isPrimary: true,
      leadTimeDays: 7,
      leadSigmaDays: 1.5,
      leadTimeSource: 'scorecard',
      moq: 24,
    },
    {
      supplierId: 's2',
      name: 'Bayou Supply',
      isPrimary: false,
      leadTimeDays: 12,
      leadSigmaDays: 0,
      leadTimeSource: 'supplier',
      moq: 10,
    },
  ],
};

describe('deriveScenario', () => {
  it('matches a direct derivePolicy call for the saved baseline', () => {
    const scenario = deriveScenario(INPUTS, {
      serviceLevel: 0.95,
      supplierId: 's1',
      leadOverride: null,
    });
    const direct = derivePolicy({
      dailyMean: 5,
      dailySigma: 2,
      leadTimeDays: 7,
      leadSigmaDays: 1.5,
      serviceLevel: 0.95,
      moq: 24,
      coverageDays: 14,
      position: 40,
    });
    expect(scenario.effectiveLead).toBe(7);
    expect(scenario.policy).toEqual(direct);
  });

  it('honors a lead-time override with zero lead variance', () => {
    const scenario = deriveScenario(INPUTS, {
      serviceLevel: 0.99,
      supplierId: 's1',
      leadOverride: 20,
    });
    expect(scenario.effectiveLead).toBe(20);
    // Override means no measured lead σ regardless of the supplier's scorecard.
    const direct = derivePolicy({
      dailyMean: 5,
      dailySigma: 2,
      leadTimeDays: 20,
      leadSigmaDays: 0,
      serviceLevel: 0.99,
      moq: 24,
      coverageDays: 14,
      position: 40,
    });
    expect(scenario.policy).toEqual(direct);
  });

  it('switches to the selected supplier and falls back to the first when unknown', () => {
    expect(
      deriveScenario(INPUTS, { serviceLevel: 0.95, supplierId: 's2', leadOverride: null }).supplier
        ?.supplierId,
    ).toBe('s2');
    expect(
      deriveScenario(INPUTS, { serviceLevel: 0.95, supplierId: 'nope', leadOverride: null })
        .supplier?.supplierId,
    ).toBe('s1');
  });
});
