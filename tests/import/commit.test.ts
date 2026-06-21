import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCsvImport } from '@/lib/import/commit';
import { getKindSpec } from '@/lib/import/field-specs';
import { autoMap } from '@/lib/import/mapping';
import { parseCsv } from '@/lib/import/parse';

/**
 * CSV import commit — real authenticated path (Block 5).
 *
 * Drives the commit core against the local stack: products upsert through the
 * caller's RLS client, sync bookkeeping through the service-role admin client.
 * Proves the headline acceptance — re-importing the same file does NOT duplicate
 * products (idempotent on the (tenant_id, sku) natural key) — plus that bad rows
 * land in sync_failures without blocking the valid ones. Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const spec = getKindSpec('product');
const EMAIL = 'it-csv-import@bayou-it.example';

interface Actor {
  client: SupabaseClient;
  tenantId: string;
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

async function makeActor(email: string, business: string): Promise<Actor> {
  const existing = await findUserId(email);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: business });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  return { client, tenantId: data?.claims?.tenant_id as string };
}

function mappingFor(csv: string) {
  return autoMap(parseCsv(csv).headers, spec);
}

async function productCount(tenantId: string): Promise<number> {
  const { count } = await admin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  return count ?? 0;
}

let A: Actor;

beforeAll(async () => {
  A = await makeActor(EMAIL, 'CSV Import Co');
}, 60_000);

afterAll(async () => {
  const t = A?.tenantId;
  if (t) {
    await admin.from('sync_failures').delete().eq('tenant_id', t);
    await admin.from('sync_runs').delete().eq('tenant_id', t);
    await admin.from('source_connections').delete().eq('tenant_id', t);
    await admin.from('products').delete().eq('tenant_id', t);
    await admin.from('subscriptions').delete().eq('tenant_id', t);
    await admin.from('tenants').delete().eq('id', t);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

// 2 valid rows + 1 bad (missing SKU).
const CSV =
  'SKU,Name,Status\nCSV-1,First widget,active\nCSV-2,Second widget,discontinued\n,No sku here,active\n';

describe('runCsvImport — first import', () => {
  it('upserts the valid rows and logs the bad row to sync_failures', async () => {
    const res = await runCsvImport({
      tenantClient: A.client,
      tenantId: A.tenantId,
      kind: 'product',
      csvText: CSV,
      mapping: mappingFor(CSV),
      idempotencyKey: 'imp-1',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.imported).toBe(2);
    expect(res.summary.failed).toBe(1);

    expect(await productCount(A.tenantId)).toBe(2);

    const { data: fails } = await admin
      .from('sync_failures')
      .select('external_ref, error_code')
      .eq('sync_run_id', res.summary.syncRunId)
      .returns<{ external_ref: string; error_code: string }[]>();
    expect(fails).toHaveLength(1);
    expect(fails?.[0]?.external_ref).toBe('3'); // the third data row
  });
});

describe('runCsvImport — re-import (idempotency)', () => {
  it('does not duplicate products when the same file is imported again', async () => {
    const before = await productCount(A.tenantId);
    const res = await runCsvImport({
      tenantClient: A.client,
      tenantId: A.tenantId,
      kind: 'product',
      csvText: CSV,
      mapping: mappingFor(CSV),
      idempotencyKey: 'imp-2',
    });
    expect(res.ok).toBe(true);
    expect(await productCount(A.tenantId)).toBe(before); // upsert, never duplicate
  });

  it('updates an existing SKU on re-import instead of inserting', async () => {
    const renamed = 'SKU,Name,Status\nCSV-1,First widget RENAMED,active\n';
    const res = await runCsvImport({
      tenantClient: A.client,
      tenantId: A.tenantId,
      kind: 'product',
      csvText: renamed,
      mapping: mappingFor(renamed),
      idempotencyKey: 'imp-3',
    });
    expect(res.ok).toBe(true);

    const { data } = await admin
      .from('products')
      .select('name')
      .eq('tenant_id', A.tenantId)
      .eq('sku', 'CSV-1')
      .single<{ name: string }>();
    expect(data?.name).toBe('First widget RENAMED');
  });
});

describe('runCsvImport — records a sync_run', () => {
  it('writes a completed sync_run with the product count', async () => {
    const { data } = await admin
      .from('sync_runs')
      .select('status, entities_processed')
      .eq('tenant_id', A.tenantId)
      .eq('workflow_run_id', 'imp-1')
      .single<{ status: string; entities_processed: Record<string, number> }>();
    expect(data?.status).toBe('completed');
    expect(data?.entities_processed.product).toBe(2);
  });
});
