/**
 * The canonical bench navigation (W2-0). Single source of truth for both the
 * rail (which renders it) and the operating-profile types (which relabel/hide by
 * href). `NavHref` is DERIVED from this list so the two can't drift.
 */

export const NAV_ITEMS = [
  { href: '/today', label: 'Today' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/forecasts', label: 'Forecasts' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/purchase-orders', label: 'Purchase Orders' },
  { href: '/procurement', label: 'Procurement' },
  { href: '/import', label: 'Import' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/reorder', label: 'Reorder' },
  { href: '/transfers', label: 'Transfers' },
  { href: '/flow', label: 'Flow' },
  { href: '/settings', label: 'Settings' },
] as const;

/** Every nav href, derived from NAV_ITEMS so the profile types stay in lockstep. */
export type NavHref = (typeof NAV_ITEMS)[number]['href'];
