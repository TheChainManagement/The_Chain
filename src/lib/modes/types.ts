/**
 * Operating-mode spine (W2-0). A "mode" is an inventory-FLOW archetype, not an
 * industry — many industries collapse to one flow. See
 * docs/WAVE2_W2-0_MODE_SPINE_DESIGN.md. Profiles live in code (the source of
 * truth); the tenants.operating_mode column only stores the key.
 */

/** Persisted on tenants.operating_mode. Mirrors the Postgres `operating_mode` enum. */
export type OperatingMode = 'distribution' | 'storeroom' | 'food';

/**
 * The demand archetype — what consumes inventory. The forecast engine reads a
 * normalized demand series; the archetype declares where that series comes from.
 * (`produce` = BOM/WIP, reserved for a later mode.)
 */
export type DemandArchetype = 'sell' | 'issue' | 'produce';

/** Nav hrefs the rail can relabel/hide per mode. Keep in sync with LeftRail's NAV. */
export type NavHref =
  | '/today'
  | '/inventory'
  | '/forecasts'
  | '/suppliers'
  | '/purchase-orders'
  | '/import'
  | '/integrations'
  | '/reorder'
  | '/flow'
  | '/settings';

/**
 * An operating profile: the declarative config a tenant's mode resolves to.
 * Everything mode-dependent reads THIS, never an inline `if (mode === ...)`.
 * Forward-wired for the full mode set; W2-0 populates what nav + terminology need.
 */
export interface OperatingProfile {
  /** The persisted key. */
  key: OperatingMode;
  /** Display name, e.g. "Distribution". */
  label: string;
  /** One-line description shown in the mode badge / settings. */
  tagline: string;
  /** Industries that map to this flow (for the future industry-selection step). */
  industries: readonly string[];
  /** What consumes inventory in this mode. */
  archetype: DemandArchetype;
  /** Short noun for the demand signal: "sales" | "issues" | "usage". */
  demandNoun: string;
  /** Per-mode nav label overrides (href → label). Default label used when absent. */
  navLabels: Partial<Record<NavHref, string>>;
  /** Nav hrefs hidden in this mode. Empty until mode-specific surfaces ship (W2-2+). */
  hiddenNav: readonly NavHref[];
}
