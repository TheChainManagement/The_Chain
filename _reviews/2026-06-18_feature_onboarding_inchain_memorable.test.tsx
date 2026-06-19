// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QboPhaseTracker } from '@/app/(app)/onboarding/QboPhaseTracker';
import { qboPhaseStage } from '@/lib/onboarding/state';

/**
 * Block 2 Wave 2b memorable-element artifact: the QBO sync phase tracker lights
 * Catalog → Suppliers → Sales in place as the initial sync advances — the chain
 * forming live inside the onboarding flow. Drives the real presentational tracker
 * over the real qboPhaseStage mapping (the same the poller feeds it) and asserts
 * the cobalt frontier walks forward, then settles fully on completion.
 */

function states(container: HTMLElement) {
  return [...container.querySelectorAll('[data-state]')].map((el) => el.getAttribute('data-state'));
}

describe('QBO onboarding phase tracker — lights in place', () => {
  it('product phase: Catalog ignites at the frontier', () => {
    const { container } = render(<QboPhaseTracker stage={qboPhaseStage('product')} done={false} />);
    expect(states(container)).toEqual(['active', 'pending', 'pending']);
  });

  it('supplier phase: Catalog done, Suppliers ignites', () => {
    const { container } = render(
      <QboPhaseTracker stage={qboPhaseStage('supplier')} done={false} />,
    );
    expect(states(container)).toEqual(['done', 'active', 'pending']);
  });

  it('stock_movement phase: Catalog + Suppliers done, Sales ignites', () => {
    const { container } = render(
      <QboPhaseTracker stage={qboPhaseStage('stock_movement')} done={false} />,
    );
    expect(states(container)).toEqual(['done', 'done', 'active']);
  });

  it('done: every link settled', () => {
    const { container } = render(<QboPhaseTracker stage={3} done={true} />);
    expect(states(container)).toEqual(['done', 'done', 'done']);
  });
});
