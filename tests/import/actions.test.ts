import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * runImport Server Action boundary (Block 5 ticket cleanup). Verifies the action's
 * own logic — per-kind role gating, small/large threshold routing, revalidation,
 * and error mapping — with the commit core, admin client, and workflow mocked.
 * The core write paths are covered by the commit/durable integration tests.
 */

const h = vi.hoisted(() => ({
  claims: { tenant_id: 't1', tenant_role: 'owner' } as Record<string, string> | null,
  runCsvImport: vi.fn(),
  ensureCsvConnection: vi.fn(async () => 'conn1'),
  start: vi.fn(async () => ({ runId: 'wf1' })),
  revalidatePath: vi.fn(),
  adminUpdate: vi.fn((_payload?: Record<string, unknown>) => ({
    eq: async () => ({ data: null, error: null }),
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getClaims: async () => ({ data: { claims: h.claims } }) },
  }),
}));
vi.mock('@/lib/import/commit', () => ({
  runCsvImport: h.runCsvImport,
  ensureCsvConnection: h.ensureCsvConnection,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: 'run1' }, error: null }) }),
      }),
      update: h.adminUpdate,
    }),
  }),
}));
vi.mock('workflow/api', () => ({ start: h.start }));
vi.mock('@/workflows/import', () => ({ importWorkflow: {} }));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));

import { runImport } from '@/app/(app)/import/actions';

const smallCsv = 'SKU,Name\nA,B\n';
const bigCsv = `SKU,Name\n${'A,B\n'.repeat(2001)}`; // 2001 data rows > threshold

function input(kind: 'product' | 'supplier' | 'stock_movement', csvText = smallCsv) {
  return { kind, csvText, mapping: {}, idempotencyKey: 'idem-1' };
}

beforeEach(() => {
  h.claims = { tenant_id: 't1', tenant_role: 'owner' };
  h.runCsvImport.mockReset();
  h.runCsvImport.mockResolvedValue({
    ok: true,
    summary: { syncRunId: 's', imported: 1, skipped: 0, failed: 0, total: 1, failures: [] },
  });
  h.start.mockReset();
  h.start.mockResolvedValue({ runId: 'wf1' });
  h.revalidatePath.mockClear();
  h.adminUpdate.mockClear();
});

describe('runImport — auth gating', () => {
  it('rejects a missing session', async () => {
    h.claims = null;
    const res = await runImport(input('product'));
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects a viewer (no write role)', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'viewer' };
    const res = await runImport(input('product'));
    expect(res.ok).toBe(false);
    expect(h.runCsvImport).not.toHaveBeenCalled();
  });

  it('rejects a planner importing movements (warehouse-only kind)', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'planner' };
    const res = await runImport(input('stock_movement'));
    expect(res.ok).toBe(false);
    expect(h.runCsvImport).not.toHaveBeenCalled();
  });

  it('allows a planner importing products', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'planner' };
    const res = await runImport(input('product'));
    expect(res.ok).toBe(true);
    expect(h.runCsvImport).toHaveBeenCalledTimes(1);
  });

  it('allows a warehouse role importing movements', async () => {
    h.claims = { tenant_id: 't1', tenant_role: 'warehouse' };
    const res = await runImport(input('stock_movement'));
    expect(res.ok).toBe(true);
  });
});

describe('runImport — routing + revalidation', () => {
  it('runs a small file synchronously and revalidates the kind surface', async () => {
    const res = await runImport(input('supplier'));
    expect(res.ok).toBe(true);
    expect('summary' in res).toBe(true);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith('/suppliers');
  });

  it('routes a large file to the durable workflow and returns a tracking key', async () => {
    const res = await runImport(input('product', bigCsv));
    expect(res).toMatchObject({ ok: true, async: true, trackingKey: 'idem-1' });
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.runCsvImport).not.toHaveBeenCalled();
  });

  it('maps an unexpected throw to a clean error', async () => {
    h.runCsvImport.mockRejectedValueOnce(new Error('boom'));
    const res = await runImport(input('product'));
    expect(res.ok).toBe(false);
  });

  it('marks the pre-created run failed if the workflow fails to start (no orphan)', async () => {
    h.start.mockRejectedValueOnce(new Error('start boom'));
    const res = await runImport(input('product', bigCsv));
    expect(res.ok).toBe(false);
    // the orphaned sync_run was marked failed, not left 'running'
    expect(h.adminUpdate).toHaveBeenCalledTimes(1);
    expect(h.adminUpdate.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
  });
});
