import { describe, expect, it } from 'vitest';
import { demandMovementTypes, demandTypesForMode } from '@/lib/modes/demand';

/**
 * W2-2 demand-source routing: the engine's demand reads (forecast batch,
 * classification, forecast-detail history) filter movement types through this
 * one mapping. Sell archetypes consume sales; issue archetypes consume
 * work-order issues. Unknown/absent modes fall back to the default profile
 * (distribution → sale), and the unbuilt produce archetype fails loud.
 */
describe('demandMovementTypes', () => {
  it('routes sell to sale and issue to issue_out', () => {
    expect(demandMovementTypes('sell')).toEqual(['sale']);
    expect(demandMovementTypes('issue')).toEqual(['issue_out']);
  });

  it('fails loud on the unbuilt produce archetype', () => {
    expect(() => demandMovementTypes('produce')).toThrow(/produce/);
  });
});

describe('demandTypesForMode', () => {
  it('maps the three shipped modes through their profiles', () => {
    expect(demandTypesForMode('distribution')).toEqual(['sale']);
    expect(demandTypesForMode('storeroom')).toEqual(['issue_out']);
    expect(demandTypesForMode('food')).toEqual(['issue_out']);
  });

  it('defaults a null/unknown mode to the distribution demand source', () => {
    expect(demandTypesForMode(null)).toEqual(['sale']);
    expect(demandTypesForMode(undefined)).toEqual(['sale']);
  });
});
