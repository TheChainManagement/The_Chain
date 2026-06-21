import { describe, expect, it } from 'vitest';
import {
  type OnboardingStateRow,
  onboardingComplete,
  qboPhaseStage,
  resolveOnboarding,
} from '@/lib/onboarding/state';

/**
 * Block 2 step-machine unit tests. Pure derivation of the five-link chain from
 * onboarding_state + live counts, plus the legacy-aware completion guard.
 */

const ZERO = { products: 0, suppliers: 0, sources: 0 };

function row(overrides: Partial<OnboardingStateRow>): OnboardingStateRow {
  return {
    path: null,
    source_connected_at: null,
    catalog_minimum_met_at: null,
    suppliers_minimum_met_at: null,
    first_forecast_ready_at: null,
    completed_at: null,
    seed_only_opt_in: false,
    ...overrides,
  };
}

describe('resolveOnboarding', () => {
  it('fresh tenant with no state: only Account is lit, path-pick needed', () => {
    const v = resolveOnboarding(null, ZERO);
    expect(v.litCount).toBe(1);
    expect(v.links[0]?.state).toBe('done');
    expect(v.links[1]?.state).toBe('active'); // Source
    expect(v.needsPathPick).toBe(true);
    expect(v.currentStep).toBe('source');
    expect(v.complete).toBe(false);
  });

  it('fresh path picked: Source lights, Catalog becomes active', () => {
    const v = resolveOnboarding(row({ path: 'fresh', source_connected_at: '2026-06-17' }), ZERO);
    expect(v.litCount).toBe(2);
    expect(v.currentStep).toBe('catalog');
    expect(v.needsPathPick).toBe(false);
    expect(v.links.find((l) => l.key === 'source')?.state).toBe('done');
  });

  it('qbo path with no source connected yet: Source stays active', () => {
    const v = resolveOnboarding(row({ path: 'qbo' }), ZERO);
    expect(v.currentStep).toBe('source');
    expect(v.links.find((l) => l.key === 'source')?.state).toBe('active');
  });

  it('qbo path with an active source connection: Source lights from live count', () => {
    const v = resolveOnboarding(row({ path: 'qbo' }), { ...ZERO, sources: 1 });
    expect(v.links.find((l) => l.key === 'source')?.state).toBe('done');
    expect(v.currentStep).toBe('catalog');
  });

  it('catalog lights from a live product count even without the stamp', () => {
    const v = resolveOnboarding(row({ path: 'fresh', source_connected_at: '2026-06-17' }), {
      ...ZERO,
      products: 2,
    });
    expect(v.links.find((l) => l.key === 'catalog')?.state).toBe('done');
    expect(v.currentStep).toBe('suppliers');
  });

  it('all minimums plus a first forecast: complete, no current step', () => {
    const v = resolveOnboarding(
      row({
        path: 'fresh',
        source_connected_at: '2026-06-17',
        catalog_minimum_met_at: '2026-06-17',
        suppliers_minimum_met_at: '2026-06-17',
        first_forecast_ready_at: '2026-06-17',
      }),
      { products: 1, suppliers: 1, sources: 0 },
    );
    expect(v.complete).toBe(true);
    expect(v.currentStep).toBeNull();
    expect(v.litCount).toBe(5);
  });

  it('is monotonic: a later done link cannot light past an earlier gap', () => {
    // forecast stamped but catalog empty (degenerate) → chain clamps at catalog.
    const v = resolveOnboarding(
      row({
        path: 'fresh',
        source_connected_at: '2026-06-17',
        first_forecast_ready_at: '2026-06-17',
      }),
      ZERO,
    );
    expect(v.currentStep).toBe('catalog');
    expect(v.litCount).toBe(2);
    expect(v.links.find((l) => l.key === 'forecast')?.state).toBe('pending');
  });
});

describe('qboPhaseStage', () => {
  it('maps each QBO sync phase to its tracker stage', () => {
    expect(qboPhaseStage('product')).toBe(0); // Catalog
    expect(qboPhaseStage('supplier')).toBe(1); // Suppliers
    expect(qboPhaseStage('stock_movement')).toBe(2); // Sales
    expect(qboPhaseStage('purchase_order')).toBe(3);
    expect(qboPhaseStage('done')).toBe(3);
  });

  it('falls back to the first stage on an unknown phase (never blank)', () => {
    expect(qboPhaseStage('something_new')).toBe(0);
    expect(qboPhaseStage('')).toBe(0);
  });
});

describe('onboardingComplete', () => {
  it('true once completed_at is stamped', () => {
    expect(onboardingComplete(row({ completed_at: '2026-06-17' }), 0)).toBe(true);
  });

  it('true for a legacy tenant: no state row but a catalog exists', () => {
    expect(onboardingComplete(null, 5)).toBe(true);
  });

  it('false for a brand-new tenant: no state, no catalog', () => {
    expect(onboardingComplete(null, 0)).toBe(false);
  });

  it('false mid-flow: state exists, not completed, even with products', () => {
    expect(onboardingComplete(row({ catalog_minimum_met_at: '2026-06-17' }), 3)).toBe(false);
  });
});
