// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OnboardingChain } from '@/app/(app)/onboarding/OnboardingChain';
import { resolveOnboarding, type OnboardingStateRow } from '@/lib/onboarding/state';

/**
 * Block 2 memorable-element artifact (FEATURES.md: "required visible artifact —
 * the onboarding chain in three states: empty → 2-of-5-lit → 5-of-5-lit"). The
 * onboarding panel IS a chain that forms in front of the operator; this renders
 * the real OnboardingChain over the real step-machine and asserts the links light
 * monotonically, that exactly one link ignites at the frontier, and that the
 * cobalt connector advances with the lit links.
 */

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

function lit(container: HTMLElement) {
  return {
    done: container.querySelectorAll('[data-state="done"]').length,
    active: container.querySelectorAll('[data-state="active"]').length,
    pending: container.querySelectorAll('[data-state="pending"]').length,
    cobaltConnectors: container.querySelectorAll('[data-connector="cobalt"]').length,
    ignite: container.querySelectorAll('[data-state="active"] span[aria-hidden="true"]').length,
  };
}

describe('onboarding chain — three states', () => {
  it('empty: 1 of 5 lit (Account), Source ignites at the frontier', () => {
    const v = resolveOnboarding(null, { products: 0, suppliers: 0, sources: 0 });
    const { container } = render(<OnboardingChain links={v.links} />);
    const s = lit(container);
    expect(s.done).toBe(1);
    expect(s.active).toBe(1);
    expect(s.pending).toBe(3);
    expect(s.ignite).toBeGreaterThanOrEqual(1); // the active link draws its cobalt ignite
  });

  it('mid: 2 of 5 lit after picking the fresh path, Catalog ignites', () => {
    const v = resolveOnboarding(row({ path: 'fresh', source_connected_at: '2026-06-17' }), {
      products: 0,
      suppliers: 0,
      sources: 0,
    });
    const { container } = render(<OnboardingChain links={v.links} />);
    const s = lit(container);
    expect(s.done).toBe(2);
    expect(s.active).toBe(1);
    // Cobalt connector fires from each done link that has a successor.
    expect(s.cobaltConnectors).toBe(2);
  });

  it('full: 5 of 5 lit, no active frontier — the operator understands the chain', () => {
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
    const { container } = render(<OnboardingChain links={v.links} />);
    const s = lit(container);
    expect(s.done).toBe(5);
    expect(s.active).toBe(0);
    // Four interior connectors all cobalt; the last link has none.
    expect(s.cobaltConnectors).toBe(4);
  });
});
