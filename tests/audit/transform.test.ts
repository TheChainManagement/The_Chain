import { describe, expect, it } from 'vitest';
import {
  AUDIT_ROLES,
  actionVerb,
  canReadAudit,
  diffFields,
  entityLabel,
  isSameUtcDay,
  RETENTION_WINDOW_DAYS,
  resolvePeriod,
  tierWindowCutoffIso,
  tierWindowLabel,
  toAuditCsv,
} from '@/lib/audit/transform';

const NOW = Date.UTC(2026, 5, 19, 14, 30); // 2026-06-19T14:30Z

describe('canReadAudit (the role gate)', () => {
  it('admits exactly owner, manager, finance', () => {
    for (const role of AUDIT_ROLES) expect(canReadAudit(role)).toBe(true);
  });
  it('refuses planner, warehouse, viewer, and junk', () => {
    for (const role of ['planner', 'warehouse', 'viewer', '', 'OWNER', undefined, null]) {
      expect(canReadAudit(role)).toBe(false);
    }
  });
});

describe('retention tier windows', () => {
  it('maps each tier to its documented span', () => {
    expect(RETENTION_WINDOW_DAYS.free).toBe(14);
    expect(RETENTION_WINDOW_DAYS.starter).toBe(365);
    expect(RETENTION_WINDOW_DAYS.standard).toBe(1825);
    expect(RETENTION_WINDOW_DAYS.pro).toBe(3650);
    expect(RETENTION_WINDOW_DAYS.enterprise).toBeNull();
  });

  it('computes a cutoff for bounded tiers and null for enterprise', () => {
    expect(tierWindowCutoffIso('starter', NOW)).toBe(
      new Date(NOW - 365 * 86_400_000).toISOString(),
    );
    expect(tierWindowCutoffIso('enterprise', NOW)).toBeNull();
  });

  it('a wider tier exposes a strictly older cutoff (the upgrade effect)', () => {
    const starter = tierWindowCutoffIso('starter', NOW) as string;
    const pro = tierWindowCutoffIso('pro', NOW) as string;
    expect(pro < starter).toBe(true);
  });

  it('labels read in human spans', () => {
    expect(tierWindowLabel('free')).toBe('Trial period');
    expect(tierWindowLabel('pro')).toBe('10 years');
    expect(tierWindowLabel('enterprise')).toBe('Unlimited');
  });
});

describe('actionVerb + entityLabel', () => {
  it('reads the op tail into a verb', () => {
    expect(actionVerb('purchase_orders.insert')).toBe('Created');
    expect(actionVerb('products.update')).toBe('Updated');
    expect(actionVerb('suppliers.delete')).toBe('Removed');
    expect(actionVerb('something.weird')).toBe('Changed');
  });
  it('handles the hand-written bootstrap action strings (past tense)', () => {
    expect(actionVerb('tenant.created')).toBe('Created');
    expect(actionVerb('subscriptions.updated')).toBe('Updated');
    expect(actionVerb('foo.deleted')).toBe('Removed');
    expect(actionVerb('onboarding.seed_only_bypass')).toBe('Changed');
  });
  it('labels tracked entity types and humanizes unknowns', () => {
    expect(entityLabel('purchase_orders')).toBe('Purchase order');
    expect(entityLabel('stock_movements')).toBe('Stock movement');
    expect(entityLabel('tenants')).toBe('Workspace');
    expect(entityLabel('po_receipt_events')).toBe('PO receipt');
    expect(entityLabel('mystery_table')).toBe('Mystery table');
  });
});

describe('diffFields', () => {
  it('insert: every after field is added, before is null', () => {
    const fields = diffFields(null, { sku: 'RVB-1', on_hand: 5 }, 'Created');
    expect(fields).toEqual([
      { key: 'on_hand', before: null, after: '5', kind: 'added' },
      { key: 'sku', before: null, after: 'RVB-1', kind: 'added' },
    ]);
  });

  it('delete: every before field is removed, after is null', () => {
    const fields = diffFields({ sku: 'RVB-1' }, null, 'Removed');
    expect(fields).toEqual([{ key: 'sku', before: 'RVB-1', after: null, kind: 'removed' }]);
  });

  it('update: only changed keys, as changed', () => {
    const fields = diffFields(
      { on_hand: 5, name: 'Pump', status: 'active' },
      { on_hand: 12, name: 'Pump', status: 'active' },
      'Updated',
    );
    expect(fields).toEqual([{ key: 'on_hand', before: '5', after: '12', kind: 'changed' }]);
  });

  it('never renders secret fields even if present in the jsonb', () => {
    const fields = diffFields(
      null,
      { sku: 'RVB-1', access_token: 'abc', encrypted_credentials: 'xyz', password: 'p' },
      'Created',
    );
    expect(fields.map((f) => f.key)).toEqual(['sku']);
  });

  it('stringifies nested json and booleans', () => {
    const fields = diffFields(null, { meta: { a: 1 }, flag: true }, 'Created');
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.after]));
    expect(byKey.meta).toBe('{"a":1}');
    expect(byKey.flag).toBe('true');
  });
});

describe('isSameUtcDay', () => {
  it('matches same UTC calendar day, rejects others', () => {
    expect(isSameUtcDay('2026-06-19T01:00:00.000Z', NOW)).toBe(true);
    expect(isSameUtcDay('2026-06-18T23:59:00.000Z', NOW)).toBe(false);
  });
});

describe('toAuditCsv', () => {
  it('emits a header and quotes/escapes cells', () => {
    const csv = toAuditCsv([
      {
        occurredAt: '2026-06-19T14:00:00.000Z',
        action: 'products.update',
        entityType: 'products',
        entityId: 'abc',
        actorUserId: 'user-1',
        changedFields: 'on_hand name',
      },
      {
        occurredAt: '2026-06-19T13:00:00.000Z',
        action: 'suppliers.insert',
        entityType: 'suppliers',
        entityId: null,
        actorUserId: null,
        changedFields: 'name "quoted"',
      },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('occurred_at,action,entity_type,entity_id,actor_user_id,changed_fields');
    expect(lines[1]).toContain('"products.update"');
    expect(lines[2]).toContain('""quoted""'); // doubled quotes
    expect(lines[2]).toContain(',"",'); // null entity_id / actor become empty cells
  });
});

describe('resolvePeriod (export window clamping)', () => {
  const cutoff = tierWindowCutoffIso('starter', NOW); // ~1 year back

  it('window/all spans cutoff..now', () => {
    expect(resolvePeriod('window', cutoff, NOW)).toEqual({
      startIso: cutoff,
      endIso: new Date(NOW).toISOString(),
    });
    expect(resolvePeriod('all', cutoff, NOW)?.startIso).toBe(cutoff);
  });

  it('a YYYY-MM inside the window resolves to that month', () => {
    const r = resolvePeriod('2026-05', cutoff, NOW);
    expect(r?.startIso).toBe('2026-05-01T00:00:00.000Z');
    expect(r?.endIso).toBe('2026-06-01T00:00:00.000Z');
  });

  it('a month older than the cutoff collapses to an empty range (no leak)', () => {
    const r = resolvePeriod('2020-01', cutoff, NOW);
    expect(r).not.toBeNull();
    expect((r as { startIso: string }).startIso).toBe(cutoff);
    expect((r as { endIso: string }).endIso).toBe(cutoff); // start === end => empty
  });

  it('clamps a future month end down to now', () => {
    const r = resolvePeriod('2026-06', cutoff, NOW);
    expect(r?.endIso).toBe(new Date(NOW).toISOString());
  });

  it('unlimited tier (null cutoff) still resolves a window', () => {
    const r = resolvePeriod('window', null, NOW);
    expect(r?.endIso).toBe(new Date(NOW).toISOString());
  });

  it('rejects garbage and out-of-range months', () => {
    expect(resolvePeriod('nonsense', cutoff, NOW)).toBeNull();
    expect(resolvePeriod('2026-13', cutoff, NOW)).toBeNull();
  });
});
