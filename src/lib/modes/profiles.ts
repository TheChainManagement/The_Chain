import type { OperatingMode, OperatingProfile } from './types';

/**
 * The operating-profile registry — the source of truth for modes (W2-0).
 * Pure data, importable from both server and client. Add a mode = add a profile
 * here + an `alter type operating_mode add value` migration. The forecast /
 * policy / reorder engine never reads this; only nav + terminology + (later)
 * the per-mode material-flow adapters do.
 */

export const DEFAULT_MODE: OperatingMode = 'distribution';

const PROFILES: Record<OperatingMode, OperatingProfile> = {
  distribution: {
    key: 'distribution',
    label: 'Distribution',
    tagline: 'Resale and wholesale. Demand comes from customer sales.',
    industries: ['distribution', 'wholesale', 'retail', 'ecommerce'],
    archetype: 'sell',
    demandNoun: 'sales',
    // Distribution is the Wave-1 baseline — default nav labels, nothing hidden.
    navLabels: {},
    hiddenNav: [],
    extensions: null,
  },
  storeroom: {
    key: 'storeroom',
    label: 'Storeroom',
    tagline: 'MRO and maintenance. Demand comes from material issued to work orders.',
    industries: ['maintenance', 'mro', 'facilities', 'construction'],
    archetype: 'issue',
    demandNoun: 'issues',
    navLabels: { '/inventory': 'Storeroom' },
    hiddenNav: [],
    extensions: null,
  },
  food: {
    key: 'food',
    label: 'Food service',
    tagline: 'Perishables. Demand comes from usage; stock turns on expiration.',
    industries: ['restaurant', 'grocery', 'commissary'],
    archetype: 'issue',
    demandNoun: 'usage',
    navLabels: { '/inventory': 'Stock' },
    hiddenNav: [],
    // Reserved: food's lot/expiry/FEFO behavior is built in a later wave.
    extensions: { expiration: true },
  },
};

/** Resolve a mode key to its profile. Falls back to the default for null/unknown keys. */
export function getProfile(mode: OperatingMode | null | undefined): OperatingProfile {
  return PROFILES[mode ?? DEFAULT_MODE] ?? PROFILES[DEFAULT_MODE];
}

/** Every profile, in display order. For settings / the future industry-selection UI. */
export function allProfiles(): readonly OperatingProfile[] {
  return [PROFILES.distribution, PROFILES.storeroom, PROFILES.food];
}
