import type { NavHref } from '@/lib/modes/nav';

/** Canonical Wave 3 member roles. Mirrors public.member_role. */
export const MEMBER_ROLES = [
  'owner',
  'manager',
  'planner',
  'warehouse',
  'finance',
  'viewer',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export type Capability =
  | 'team.manage_all'
  | 'team.manage_lower'
  | 'locations.manage'
  | 'catalog.manage'
  | 'planning.manage'
  | 'procurement.manage'
  | 'inventory.execute'
  | 'transfers.execute'
  | 'integrations.manage'
  | 'billing.view'
  | 'audit.view'
  | 'valuation.view'
  | 'operations.view';

export interface RoleProfile {
  label: string;
  description: string;
  capabilities: readonly Capability[];
  hiddenNav: readonly NavHref[];
  todayFocus: 'network' | 'planning' | 'warehouse' | 'finance' | 'overview';
}

const OPERATIONS: Capability = 'operations.view';

export const ROLE_PROFILES: Readonly<Record<MemberRole, RoleProfile>> = {
  owner: {
    label: 'Owner',
    description: 'Company control, team administration, and operating exceptions.',
    capabilities: [
      'team.manage_all',
      'locations.manage',
      'catalog.manage',
      'planning.manage',
      'procurement.manage',
      'inventory.execute',
      'transfers.execute',
      'integrations.manage',
      'billing.view',
      'audit.view',
      'valuation.view',
      OPERATIONS,
    ],
    hiddenNav: [],
    todayFocus: 'network',
  },
  manager: {
    label: 'Manager',
    description: 'Operating control, lower-role administration, and approvals.',
    capabilities: [
      'team.manage_lower',
      'locations.manage',
      'catalog.manage',
      'planning.manage',
      'procurement.manage',
      'inventory.execute',
      'transfers.execute',
      'integrations.manage',
      'audit.view',
      'valuation.view',
      OPERATIONS,
    ],
    hiddenNav: [],
    todayFocus: 'network',
  },
  planner: {
    label: 'Planner',
    description: 'Demand, replenishment, sourcing, and purchase planning.',
    capabilities: [
      'catalog.manage',
      'planning.manage',
      'procurement.manage',
      'valuation.view',
      OPERATIONS,
    ],
    hiddenNav: ['/integrations', '/settings'],
    todayFocus: 'planning',
  },
  warehouse: {
    label: 'Warehouse',
    description: 'Receipts, issues, counts, holds, and physical transfers.',
    capabilities: ['inventory.execute', 'transfers.execute', OPERATIONS],
    hiddenNav: [
      '/forecasts',
      '/suppliers',
      '/procurement',
      '/import',
      '/integrations',
      '/reorder',
      '/settings',
    ],
    todayFocus: 'warehouse',
  },
  finance: {
    label: 'Finance',
    description: 'Inventory value, commitments, billing, and audit oversight.',
    capabilities: ['billing.view', 'audit.view', 'valuation.view', OPERATIONS],
    hiddenNav: ['/forecasts', '/suppliers', '/procurement', '/import', '/integrations', '/reorder'],
    todayFocus: 'finance',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only operating visibility.',
    capabilities: [OPERATIONS],
    hiddenNav: ['/import', '/integrations', '/settings'],
    todayFocus: 'overview',
  },
};

export function isMemberRole(value: string | null | undefined): value is MemberRole {
  return MEMBER_ROLES.includes(value as MemberRole);
}

export function roleCan(role: MemberRole, capability: Capability): boolean {
  return ROLE_PROFILES[role].capabilities.includes(capability);
}

export function canManageRole(actor: MemberRole, target: MemberRole, next: MemberRole): boolean {
  if (actor === 'owner') return true;
  if (actor !== 'manager') return false;
  const privileged: ReadonlySet<MemberRole> = new Set(['owner', 'manager']);
  return !privileged.has(target) && !privileged.has(next);
}
