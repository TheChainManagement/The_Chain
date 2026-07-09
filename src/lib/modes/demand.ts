import { getProfile } from './profiles';
import type { DemandArchetype, OperatingMode } from './types';

/**
 * Demand-source routing (W2-2) — the first place the engine reads the mode
 * spine. The forecast/classification engine consumes a normalized demand
 * series; the archetype declares WHICH movement types constitute demand:
 * sales for distribution, work-order issues for a storeroom. Quantities are
 * bucketed via Math.abs (classification convention), so the sign difference
 * between sale rows and issue_out rows (both negative-or-positive by source)
 * never reaches the math.
 *
 * Pure module: importable by pure libs and tests. Fail-loud on archetypes with
 * no shipped demand source (W2-0 codex round-1 resolver convention).
 */
export function demandMovementTypes(archetype: DemandArchetype): readonly string[] {
  switch (archetype) {
    case 'sell':
      return ['sale'];
    case 'issue':
      return ['issue_out'];
    case 'produce':
      // Reserved for the manufacturing wave (production_consumption). No mode
      // maps to it yet; reaching this is a wiring bug, not a default.
      throw new Error('demandMovementTypes: produce archetype has no demand source yet');
  }
}

/** Mode key → demand movement types, via the profile registry. */
export function demandTypesForMode(mode: OperatingMode | null | undefined): readonly string[] {
  return demandMovementTypes(getProfile(mode).archetype);
}
