import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QboSourceAdapter } from '@/lib/qbo/adapter';
import { QboClient } from '@/lib/qbo/client';
import { FixtureTransport } from '@/lib/qbo/fixtures';
import { syncCatalogFromAdapter } from '@/lib/qbo/sync-core';

/**
 * QBO initial-sync write core (Block 6, Wave 6.2b) — the admin/service-role path
 * the durable workflow step runs, driven by the sandbox fixture adapter (so no
 * Intuit creds are needed). Proves the slice's contract against the real local
 * Supabase: items→products, vendors→suppliers, bills+sales→stock_movements; the
 * QBO-Item-Id→product_id resolution; source='qbo' with a real entity source_ref;
 * and crash-safety (a second full run produces zero duplicate rows). Requires
 * `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-qbo-sync@bayou-it.example';

let tenantId: string;
let connectionId: string;

function fixtureAdapter(tenant: string): QboSourceAdapter {
  const client = new QboClient({ realmId: 'sandbox', environment: 'sandbox' }, new FixtureTransport());
  return new QboSourceAdapter(client, tenant);
}

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

async function newSyncRun(): Promise<string> {
  const { data } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: connectionId,
      workflow_run_id: `qbo-sync-${Math.round(performance.now())}-${Math.random()}`,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: { phase: 'product', processed: 0, total: 0, results: {}, done: false },
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

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email: EMAIL, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'QBO Sync Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;
  const { data: conn } = await admin
    .from('source_connections')
    .insert({ tenant_id: tenantId, source: 'qbo', status: 'active', capabilities: {} })
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
    await admin.from('suppliers').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('syncCatalogFromAdapter — initial QBO sync into the catalog', () => {
  it('writes items, vendors, and movements, then finalizes the run', async () => {
    const syncRunId = await newSyncRun();
    const counts = await syncCatalogFromAdapter(admin, fixtureAdapter(tenantId), tenantId, syncRunId, connectionId);

    // 5 Inventory items (the Service item is skipped, not an error); 4 vendors.
    expect(counts.catalog).toBe(5);
    expect(counts.suppliers).toBe(4);
    expect(counts.receipts + counts.sales).toBeGreaterThan(0);
    expect(counts.ordered).toBeGreaterThan(0);
    expect(counts.errors).toBe(0);

    expect(await count('products')).toBe(5);
    expect(await count('suppliers')).toBe(4);
    expect(await count('stock_movements')).toBe(counts.receipts + counts.sales);

    const { data: run } = await admin
      .from('sync_runs')
      .select('status, cursor')
      .eq('id', syncRunId)
      .single<{ status: string; cursor: { done?: boolean } }>();
    expect(run?.status).toBe('completed');
    expect(run?.cursor?.done).toBe(true);
  });

  it('resolves movements to products by QBO Item Id and tags source=qbo', async () => {
    const { data: mv } = await admin
      .from('stock_movements')
      .select('product_id, source, source_ref, type')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single<{ product_id: string; source: string; source_ref: string; type: string }>();

    expect(mv?.product_id).toBeTruthy(); // resolved via products.external_ids->>'qbo'
    expect(mv?.source).toBe('qbo');
    expect(mv?.source_ref?.startsWith('qbo:')).toBe(true); // real entity ref, not a content hash
  });

  it('is idempotent: a second full run adds zero duplicate rows', async () => {
    const before = {
      products: await count('products'),
      suppliers: await count('suppliers'),
      movements: await count('stock_movements'),
    };

    const syncRunId = await newSyncRun();
    await syncCatalogFromAdapter(admin, fixtureAdapter(tenantId), tenantId, syncRunId, connectionId);

    expect(await count('products')).toBe(before.products);
    expect(await count('suppliers')).toBe(before.suppliers);
    expect(await count('stock_movements')).toBe(before.movements);
  });
});
