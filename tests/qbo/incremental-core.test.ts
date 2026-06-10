import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QboSourceAdapter } from '@/lib/qbo/adapter';
import { QboClient } from '@/lib/qbo/client';
import { productFingerprint } from '@/lib/qbo/conflict';
import { syncIncremental } from '@/lib/qbo/incremental-core';
import type { QboRequest, QboResponse, QboTransport } from '@/lib/qbo/transport';

/**
 * QBO incremental sync (Wave 6.3-B) — the conflict policy + delta writes against
 * real local Supabase, driven by a SCRIPTED transport so each branch (clean
 * refresh, last-write-wins, needs_review + dedup, movement append) is exact.
 * Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAIL = 'it-qbo-incremental@bayou-it.example';

let tenantId: string;
let connectionId: string;

/** A transport that returns exactly the rows configured per QBO entity. */
class ScriptedTransport implements QboTransport {
  constructor(private rows: Partial<Record<string, unknown[]>>) {}
  async request(req: QboRequest): Promise<QboResponse> {
    const query = decodeURIComponent((req.url.split('query=')[1] ?? '').split('&')[0] ?? '');
    const entity = query.match(/FROM\s+(\w+)/i)?.[1] ?? '';
    const rows = this.rows[entity] ?? [];
    return { status: 200, headers: {}, body: { QueryResponse: { [entity]: rows, startPosition: 1, maxResults: rows.length } } };
  }
}

function adapterFor(rows: Partial<Record<string, unknown[]>>): QboSourceAdapter {
  return new QboSourceAdapter(
    new QboClient({ realmId: 'sandbox', environment: 'sandbox' }, new ScriptedTransport(rows)),
    tenantId,
  );
}

const item = (over: Record<string, unknown>) => ({
  Id: '101',
  Name: 'Bolt',
  Sku: 'CHB-0801',
  Type: 'Inventory',
  MetaData: { LastUpdatedTime: '2026-06-09T00:00:00-00:00' },
  ...over,
});

async function seedProduct(fields: {
  name: string;
  storedName: string; // the name the qbo_fp baseline was taken from
  updatedAt: string;
}): Promise<string> {
  await admin.from('products').delete().eq('tenant_id', tenantId);
  const { data } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      sku: 'CHB-0801',
      name: fields.name,
      status: 'active',
      external_ids: { qbo: '101', qbo_fp: productFingerprint({ name: fields.storedName, status: 'active' }) },
      external_updated_at: '2026-05-01T00:00:00.000Z',
      updated_at: fields.updatedAt,
    })
    .select('id')
    .single<{ id: string }>();
  return data?.id ?? '';
}

async function newRun(): Promise<string> {
  const { data } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: connectionId,
      workflow_run_id: `inc-${Math.round(performance.now())}-${Math.random()}`,
      status: 'running',
      started_at: new Date().toISOString(),
      cursor: {},
    })
    .select('id')
    .single<{ id: string }>();
  return data?.id ?? '';
}

const run = (rows: Partial<Record<string, unknown[]>>, runId: string) =>
  syncIncremental(admin, adapterFor(rows), { tenantId, connectionId, syncRunId: runId }, '2026-05-15T00:00:00.000Z', connectionId);

async function conflicts(): Promise<{ policy_decision: string; applied_resolution: string }[]> {
  const { data } = await admin
    .from('sync_conflicts')
    .select('policy_decision, applied_resolution')
    .eq('tenant_id', tenantId)
    .returns<{ policy_decision: string; applied_resolution: string }[]>();
  return data ?? [];
}

async function findUserId(email: string): Promise<string | undefined> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users.find((u) => u.email === email)?.id;
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email: EMAIL, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'QBO Incremental Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;
  const { data: conn } = await admin
    .from('source_connections')
    .insert({ tenant_id: tenantId, source: 'qbo', status: 'active', capabilities: {}, last_synced_at: '2026-05-15T00:00:00.000Z' })
    .select('id')
    .single<{ id: string }>();
  connectionId = conn?.id ?? '';
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    for (const t of ['sync_conflicts', 'sync_failures', 'sync_runs', 'source_connections', 'stock_movements', 'products', 'suppliers', 'locations', 'subscriptions']) {
      await admin.from(t).delete().eq('tenant_id', tenantId);
    }
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('syncIncremental — conflict policy', () => {
  it('clean refresh: remote changed, local untouched → applies, no conflict', async () => {
    const id = await seedProduct({ name: 'Bolt', storedName: 'Bolt', updatedAt: '2026-05-20T00:00:00.000Z' });
    const summary = await run({ Item: [item({ Name: 'Cobalt Bolt v2' })] }, await newRun());

    const { data } = await admin.from('products').select('name').eq('id', id).single<{ name: string }>();
    expect(data?.name).toBe('Cobalt Bolt v2');
    expect(summary.updated).toBe(1);
    expect(await conflicts()).toHaveLength(0);
  });

  it('LWW: local edited + remote newer → applies remote, logs accept_remote', async () => {
    await admin.from('sync_conflicts').delete().eq('tenant_id', tenantId);
    const id = await seedProduct({ name: 'Operator Bolt', storedName: 'Bolt', updatedAt: '2026-06-05T00:00:00.000Z' });
    await run({ Item: [item({ Name: 'QBO Bolt', MetaData: { LastUpdatedTime: '2026-06-09T00:00:00-00:00' } })] }, await newRun());

    const { data } = await admin.from('products').select('name').eq('id', id).single<{ name: string }>();
    expect(data?.name).toBe('QBO Bolt'); // remote newer wins
    const c = await conflicts();
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ policy_decision: 'last_write_wins', applied_resolution: 'accept_remote' });
  });

  it('needs_review: both changed, equal clocks → keeps local, queues pending (deduped on re-run)', async () => {
    await admin.from('sync_conflicts').delete().eq('tenant_id', tenantId);
    const id = await seedProduct({ name: 'Operator Bolt', storedName: 'Bolt', updatedAt: '2026-06-09T00:00:00+00:00' });
    const rows = { Item: [item({ Name: 'QBO Bolt', MetaData: { LastUpdatedTime: '2026-06-09T00:00:00+00:00' } })] };
    await run(rows, await newRun());

    const { data } = await admin.from('products').select('name').eq('id', id).single<{ name: string }>();
    expect(data?.name).toBe('Operator Bolt'); // untouched, awaiting review
    let c = await conflicts();
    expect(c).toHaveLength(1);
    expect(c[0]?.policy_decision).toBe('needs_review');

    await run(rows, await newRun()); // re-run must NOT spawn a second pending conflict
    c = await conflicts();
    expect(c).toHaveLength(1);
  });

  it('movement append: a new bill line is inserted as a receipt movement', async () => {
    await seedProduct({ name: 'Bolt', storedName: 'Bolt', updatedAt: '2026-05-20T00:00:00.000Z' });
    const before = await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    const bill = {
      Id: '901',
      TxnDate: '2026-06-08',
      Line: [{ DetailType: 'ItemBasedExpenseLineDetail', ItemBasedExpenseLineDetail: { ItemRef: { value: '101' }, Qty: 50 } }],
      MetaData: { LastUpdatedTime: '2026-06-08T00:00:00-00:00' },
    };
    const summary = await run({ Bill: [bill] }, await newRun());
    expect(summary.movements).toBe(1);
    const after = await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);

    // Replay the SAME bill: append-only + ignoreDuplicates → zero new rows AND the
    // operator-facing counter reports 0, not a phantom batch (Codex round-1 fix).
    const replay = await run({ Bill: [bill] }, await newRun());
    expect(replay.movements).toBe(0);
    const afterReplay = await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    expect(afterReplay.count ?? 0).toBe(after.count ?? 0);
  });
});
