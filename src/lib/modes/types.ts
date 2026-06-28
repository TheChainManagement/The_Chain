import type { NavHref } from './nav';

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

/**
 * Reserved per-mode extension seam (design §3.5 / §5). Mode-specific structural
 * behavior the spine wires for but does NOT implement yet: food lot/expiry/FEFO,
 * manufacturing BOM/WIP, clinical regulated custody. Declared per mode now
 * (food → expiration); the ADAPTERS that act on it are built with those modes.
 */
export interface ModeExtensions {
  /** Food/clinical: stock is lot/expiry tracked and picks honor FEFO. */
  readonly expiration?: boolean;
  /** Manufacturing: stock is produced by consuming a BOM (transformation). */
  readonly billOfMaterials?: boolean;
}

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
  /**
   * Reserved structural seam (food lot/expiry, manufacturing BOM, ...). Declared
   * per mode (food → expiration); `null` when a mode has no structural extension.
   * The per-mode material-flow ADAPTERS that READ this land in W2-2, where they
   * are implemented and tested rather than declared dead now.
   */
  extensions: ModeExtensions | null;
}
