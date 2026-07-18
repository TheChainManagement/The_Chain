import { describe, expect, it } from 'vitest';
import { canManageRole, MEMBER_ROLES, ROLE_PROFILES, roleCan } from '@/lib/access/roles';

describe('Wave 3 role capability registry', () => {
  it('defines every database member role exactly once', () => {
    expect(MEMBER_ROLES).toEqual(['owner', 'manager', 'planner', 'warehouse', 'finance', 'viewer']);
    expect(Object.keys(ROLE_PROFILES)).toEqual(MEMBER_ROLES);
  });

  it('keeps financial and physical authority separated', () => {
    expect(roleCan('finance', 'billing.view')).toBe(true);
    expect(roleCan('finance', 'inventory.execute')).toBe(false);
    expect(roleCan('warehouse', 'inventory.execute')).toBe(true);
    expect(roleCan('warehouse', 'billing.view')).toBe(false);
  });

  it('lets managers administer lower roles without granting privileged roles', () => {
    expect(canManageRole('manager', 'planner', 'warehouse')).toBe(true);
    expect(canManageRole('manager', 'planner', 'manager')).toBe(false);
    expect(canManageRole('manager', 'manager', 'viewer')).toBe(false);
    expect(canManageRole('owner', 'manager', 'owner')).toBe(true);
    expect(canManageRole('planner', 'viewer', 'planner')).toBe(false);
  });
});
