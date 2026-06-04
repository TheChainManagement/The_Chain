import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCsvImport } from '@/lib/import/commit';
import { getKindSpec, type ImportableKind } from '@/lib/import/field-specs';
import { autoMap } from '@/lib/import/mapping';
import { parseCsv } from '@/lib/import/parse';

/**
 * Supplier + stock-movement import writers — real authenticated path (Block 5,
 * Wave 5.2). Drives the commit core against the local stack for the two new
 * kinds:
 *   - suppliers upsert case-insensitively on (tenant_id, lower(name)) via the
 *     import_suppliers RPC — re-importing "Atlas"/"atlas" updates, never dupes;
 *   - movements resolve SKU→product, auto-provision a Primary location, and
 *     dedupe a re-uploaded file on the content-hash source_ref (skipped, not
 *     double-posted). Unknown SKUs + unreadable dates land in sync_failures.
 * Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = 'it-csv-writers@bayou-it.example';

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

function run(actor: Actor, kind: ImportableKind, csv: string, idempotencyKey: string) {
  const spec = getKindSpec(kind);
  return runCsvImport({
    tenantClient: actor.client,
    tenantId: actor.tenantId,
    kind,
    csvText: csv,
    mapping: autoMap(parseCsv(csv).headers, spec),
    idempotencyKey,
  });
}

async function tableCount(table: string, tenantId: string): Promise<number> {
  const { count } = await admin
    .from(table)
    .select('tenant_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  return count ?? 0;
}

let A: Actor;

beforeAll(async () => {
  A = await makeActor(EMAIL, 'Writers Co');
}, 60_000);

afterAll(async () => {
  const t = A?.tenantId;
  if (t) {
    await admin.from('sync_failures').delete().eq('tenant_id', t);
    await admin.from('sync_runs').delete().eq('tenant_id', t);
    await admin.from('source_connections').delete().eq('tenant_id', t);
    await admin.from('stock_movements').delete().eq('tenant_id', t);
    await admin.from('products').delete().eq('tenant_id', t);
    await admin.from('suppliers').delete().eq('tenant_id', t);
    await admin.from('locations').delete().eq('tenant_id', t);
    await admin.from('subscriptions').delete().eq('tenant_id', t);
    await admin.from('tenants').delete().eq('id', t);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('runCsvImport — suppliers', () => {
  const SUPPLIERS = 'Name,Lead Time,Min Order,Status\nAtlas Foods,7,500,active\nBayou Supply,14,,active\n';

  it('upserts suppliers with their terms', async () => {
    const res = await run(A, 'supplier', SUPPLIERS, 'sup-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.imported).toBe(2);
    expect(await tableCount('suppliers', A.tenantId)).toBe(2);

    const { data } = await admin
      .from('suppliers')
      .select('default_lead_time_days, min_order_value')
      .eq('tenant_id', A.tenantId)
      .eq('name', 'Atlas Foods')
      .single<{ default_lead_time_days: number; min_order_value: string }>();
    expect(data?.default_lead_time_days).toBe(7);
    expect(Number(data?.min_order_value)).toBe(500);
  });

  it('is case-insensitive idempotent: "atlas foods" updates, never duplicates', async () => {
    const before = await tableCount('suppliers', A.tenantId);
    const lower = 'Name,Lead Time,Min Order,Status\natlas foods,10,750,active\n';
    const res = await run(A, 'supplier', lower, 'sup-2');
    expect(res.ok).toBe(true);
    // No new supplier row — the lower-case name folded onto the existing one.
    expect(await tableCount('suppliers', A.tenantId)).toBe(before);

    const { data } = await admin
      .from('suppliers')
      .select('default_lead_time_days')
      .eq('tenant_id', A.tenantId)
      .ilike('name', 'atlas foods')
      .single<{ default_lead_time_days: number }>();
    expect(data?.default_lead_time_days).toBe(10); // updated in place
  });

  it('rejects an in-file case-collision as a duplicate_key row', async () => {
    const dupes = 'Name,Lead Time\nNoble Goods,3\nNOBLE GOODS,9\n';
    const res = await run(A, 'supplier', dupes, 'sup-3');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.imported).toBe(1);
    expect(res.summary.failed).toBe(1);
  });
});

describe('runCsvImport — stock movements', () => {
  // Catalog the movements reference; one row points at a SKU that won't exist.
  const PRODUCTS = 'SKU,Name\nMOV-1,Movement widget\nMOV-2,Movement gadget\n';
  const MOVEMENTS =
    'SKU,Movement,Quantity,Date\nMOV-1,sale,-5,2026-03-15\nMOV-2,receipt,100,2026-03-16\nNOPE-9,sale,-1,2026-03-15\nMOV-1,adjustment,2,not-a-date\n';

  it('seeds the catalog first', async () => {
    const res = await run(A, 'product', PRODUCTS, 'mov-prep');
    expect(res.ok).toBe(true);
  });

  it('writes valid movements, auto-creates a Primary location, and logs bad rows', async () => {
    expect(await tableCount('locations', A.tenantId)).toBe(0);

    const res = await run(A, 'stock_movement', MOVEMENTS, 'mov-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.imported).toBe(2); // MOV-1 sale, MOV-2 receipt
    expect(res.summary.failed).toBe(2); // unknown SKU + unreadable date
    expect(res.summary.skipped).toBe(0);

    // A single Primary location was provisioned for the greenfield tenant.
    const { data: loc } = await admin
      .from('locations')
      .select('name')
      .eq('tenant_id', A.tenantId)
      .single<{ name: string }>();
    expect(loc?.name).toBe('Primary');
    expect(await tableCount('stock_movements', A.tenantId)).toBe(2);

    const { data: fails } = await admin
      .from('sync_failures')
      .select('external_ref, error_code')
      .eq('sync_run_id', res.summary.syncRunId)
      .returns<{ external_ref: string; error_code: string }[]>();
    const codes = (fails ?? []).map((f) => f.error_code).sort();
    expect(codes).toEqual(['invalid_date', 'unknown_sku']);
  });

  it('dedupes a re-uploaded file: nothing new, the valid rows are skipped', async () => {
    const before = await tableCount('stock_movements', A.tenantId);
    const res = await run(A, 'stock_movement', MOVEMENTS, 'mov-2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.imported).toBe(0);
    expect(res.summary.skipped).toBe(2); // both valid rows already on file
    expect(await tableCount('stock_movements', A.tenantId)).toBe(before); // no double-post
  });
});
