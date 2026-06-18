/**
 * Onboarding step-machine (Block 2, pure).
 *
 * The onboarding flow IS a chain that forms in front of the operator: five links
 * — Account → Source → Catalog → Suppliers → Forecast — each ignites cobalt as it
 * completes. This module derives those link states (and the current step) from
 * `onboarding_state` plus live counts, with NO IO so it can be unit-tested and
 * reused by the page, the guard, and the memorable artifact.
 *
 * Done-ness is belt-and-suspenders: a link reads `done` from EITHER the stamped
 * `onboarding_state` timestamp OR the live row count, so the chain reflects
 * reality even if a stamp drifts. The chain is monotonic — the first not-done
 * link is `active`, everything after it `pending` — so it never shows a gap.
 *
 * MG-approved architecture (2026-06-17): a state-machine over onboarding_state +
 * reuse of the existing qboInitialSyncWorkflow / forecastTenantBatchWorkflow,
 * rather than a formal `onboardingWorkflow` orchestrator that would only park
 * waiting on user clicks. FEATURES deviation, flagged in the evidence file.
 */

export type OnboardingPath = 'qbo' | 'csv' | 'fresh';

export interface OnboardingStateRow {
  path: OnboardingPath | null;
  source_connected_at: string | null;
  catalog_minimum_met_at: string | null;
  suppliers_minimum_met_at: string | null;
  first_forecast_ready_at: string | null;
  completed_at: string | null;
  seed_only_opt_in: boolean;
}

export interface OnboardingCounts {
  /** Active products in the catalog. */
  products: number;
  /** Suppliers (any status — having entered one clears the minimum). */
  suppliers: number;
  /** Active source_connections (QBO/CSV). */
  sources: number;
}

export type StepKey = 'account' | 'source' | 'catalog' | 'suppliers' | 'forecast';

export interface OnboardingLink {
  key: StepKey;
  /** Mono-caps step label for ChainLink (e.g. 'CATALOG'). */
  step: string;
  /** Plex Sans heading for ChainLink. */
  label: string;
  state: 'done' | 'active' | 'pending';
}

export interface OnboardingView {
  links: OnboardingLink[];
  /** The link the operator is on, or null once every link is done. */
  currentStep: StepKey | null;
  /** Count of `done` links (drives the "N of 5" read + the artifact). */
  litCount: number;
  /** Every link done — onboarding is finished, route to /today. */
  complete: boolean;
  path: OnboardingPath | null;
  /** No path chosen yet — show the path-picker. */
  needsPathPick: boolean;
}

function sourceLabel(path: OnboardingPath | null): string {
  switch (path) {
    case 'qbo':
      return 'QuickBooks';
    case 'csv':
      return 'Spreadsheet';
    case 'fresh':
      return 'Starting fresh';
    default:
      return 'Choose a path';
  }
}

/**
 * Resolve the five-link chain from persisted state + live counts. Pure.
 */
export function resolveOnboarding(
  state: OnboardingStateRow | null,
  counts: OnboardingCounts,
): OnboardingView {
  const path = state?.path ?? null;

  // Per-link done predicates: stamped timestamp OR live truth.
  const accountDone = true; // reaching this surface means the tenant graph exists
  const sourceDone =
    path != null && (path === 'fresh' || state?.source_connected_at != null || counts.sources > 0);
  const catalogDone = state?.catalog_minimum_met_at != null || counts.products > 0;
  const suppliersDone = state?.suppliers_minimum_met_at != null || counts.suppliers > 0;
  const forecastDone = state?.first_forecast_ready_at != null;

  const dones: Array<{ key: StepKey; step: string; label: string; done: boolean }> = [
    { key: 'account', step: 'ACCOUNT', label: 'Workshop created', done: accountDone },
    { key: 'source', step: 'SOURCE', label: sourceLabel(path), done: sourceDone },
    { key: 'catalog', step: 'CATALOG', label: 'Your catalog', done: catalogDone },
    { key: 'suppliers', step: 'SUPPLIERS', label: 'Your suppliers', done: suppliersDone },
    { key: 'forecast', step: 'FORECAST', label: 'First forecast', done: forecastDone },
  ];

  // Monotonic assignment: the first not-done link is active; the rest pending.
  const activeIdx = dones.findIndex((d) => !d.done);
  const links: OnboardingLink[] = dones.map((d, i) => ({
    key: d.key,
    step: d.step,
    label: d.label,
    state: activeIdx === -1 || i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }));

  const complete = activeIdx === -1;
  return {
    links,
    currentStep: complete ? null : (dones[activeIdx]?.key ?? null),
    litCount: links.filter((l) => l.state === 'done').length,
    complete,
    path,
    needsPathPick: path == null,
  };
}

/**
 * Has this tenant finished (or never needed) onboarding? Used by the route guards.
 * A legacy tenant predating Block 2 has no onboarding_state row but already has a
 * catalog — treat that as complete so the guard never traps an existing account.
 */
export function onboardingComplete(
  state: OnboardingStateRow | null,
  productCount: number,
): boolean {
  if (state?.completed_at != null) return true;
  if (state == null && productCount > 0) return true;
  return false;
}
