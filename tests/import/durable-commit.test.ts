import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runImportDurable } from '@/lib/import/durable-commit';

/**
 * Durable import write core (Block 5, Wave 5.2-durable) — the admin/service-role
 * path the Workflow step runs. Proves the crash-safety properties without the
 * workflow wrapper: idempotent re-runs don't duplicate, a resumed run (cursor at
 * total) skips the already-done work, and movement dedup holds across runs.
 * Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAIL = 'it-csv-durable@bayou-it.example';

let tenantId: string;
let connectionId: string;

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

/** A fresh sync_run for one durable run; mirrors what the action pre-creates. */
async function newSyncRun(kind: string): Promise<string> {
  const { data } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: connectionId,
      workflow_run_id: `durable-${kind}-${Math.round(performance.now())}-${Math.random()}`,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { processed: 0, total: 0, kind },
    })
    .select('id')
    .single<{ id: string }>();
  return data?.id ?? '';
}

async function count(table: string): Promise<number> {
  const { count: c } = await admin
    .from(table)
    .select('tenant_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  return c ?? 0;
}

const mapping = (fields: Record<string, string>) => fields;

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email: EMAIL, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'Durable Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;
  const { data: conn } = await admin
    .from('source_connections')
    .insert({ tenant_id: tenantId, source: 'csv', status: 'active', capabilities: {} })
    .select('id')
    .single<{ id: string }>();
  connectionId = conn?.id ?? '';
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('sync_failures').delete().eq('tenant_id', tenantId);
    await admin.from('sync_runs').delete().eq('tenant_id', tenantId);
    await admin.from('source_connections').delete().eq('tenant_id', tenantId);
    await admin.from('stock_movements').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

const PRODUCTS = 'DUR-1,Durable one\nDUR-2,Durable two\nDUR-3,Durable three\n';
const productMap = mapping({ sku: 'SKU', name: 'Name' });
const productCsv = `SKU,Name\n${PRODUCTS}`;

describe('runImportDurable — products (admin path)', () => {
  it('writes all rows and finalizes the sync_run', async () => {
    const syncRunId = await newSyncRun('product');
    const summary = await runImportDurable({
      tenantId,
      kind: 'product',
      csvText: productCsv,
      mapping: productMap,
      syncRunId,
    });
    expect(summary.imported).toBe(3);
    expect(await count('products')).toBe(3);

    const { data } = await admin
      .from('sync_runs')
      .select('status, cursor')
      .eq('id', syncRunId)
      .single<{ status: string; cursor: { done?: boolean; total?: number } }>();
    expect(data?.status).toBe('completed');
    expect(data?.cursor?.done).toBe(true);
    expect(data?.cursor?.total).toBe(3);
  });

  it('is idempotent: a fresh re-run does not duplicate', async () => {
    const syncRunId = await newSyncRun('product');
    await runImportDurable({ tenantId, kind: 'product', csvText: productCsv, mapping: productMap, syncRunId });
    expect(await count('products')).toBe(3); // upsert, never duplicate
  });

  it('resumes: re-running a completed run skips the already-done work', async () => {
    // Re-use a run whose cursor.processed is already at total → every batch is skipped.
    const syncRunId = await newSyncRun('product');
    await admin.from('sync_runs').update({ cursor: { processed: 3, total: 3, kind: 'product' } }).eq('id', syncRunId);
    const summary = await runImportDurable({
      tenantId,
      kind: 'product',
      csvText: productCsv,
      mapping: productMap,
      syncRunId,
    });
    expect(summary.imported).toBe(3); // re-counted from the cursor, not rewritten
    expect(await count('products')).toBe(3);
  });
});

describe('runImportDurable — movements (admin path)', () => {
  const movementCsv =
    'SKU,Movement,Quantity,Date\nDUR-1,sale,-7,2026-02-10\nDUR-2,receipt,40,2026-02-11\nGHOST,sale,-1,2026-02-10\n';
  const movementMap = mapping({
    productExternalId: 'SKU',
    type: 'Movement',
    quantity: 'Quantity',
    occurredAt: 'Date',
  });

  it('writes valid movements, auto-creates Primary, logs the unknown SKU', async () => {
    const syncRunId = await newSyncRun('stock_movement');
    const summary = await runImportDurable({
      tenantId,
      kind: 'stock_movement',
      csvText: movementCsv,
      mapping: movementMap,
      syncRunId,
    });
    expect(summary.imported).toBe(2);
    expect(summary.failed).toBe(1);
    expect(await count('stock_movements')).toBe(2);
    expect(await count('locations')).toBe(1);
  });

  it('dedupes a fresh re-run on the content hash (no double-post)', async () => {
    const syncRunId = await newSyncRun('stock_movement');
    const summary = await runImportDurable({
      tenantId,
      kind: 'stock_movement',
      csvText: movementCsv,
      mapping: movementMap,
      syncRunId,
    });
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(2);
    expect(await count('stock_movements')).toBe(2);
  });
});
