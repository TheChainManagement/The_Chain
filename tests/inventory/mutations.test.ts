import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Block 3+4 mutation + RLS integration (Codex "no action/RLS integration tests").
 *
 * Exercises the real authenticated path — minted JWT → PostgREST/RPC under RLS —
 * for the product↔supplier link RPCs and cross-tenant isolation, the way the
 * Server Actions actually run. Complements the pure transform unit tests.
 * Requires the local Supabase stack (`supabase start`).
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Actor {
  client: SupabaseClient;
  userId: string;
  tenantId: string;
  email: string;
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
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'integration-pw',
    email_confirm: true,
  });
  // Tolerate a residual user from an aborted run: reuse it (same known password).
  let userId = data?.user?.id;
  if (error || !userId) {
    userId = await findUserId(email);
    if (!userId) throw error ?? new Error('createUser failed');
  }
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: business });
  await client.auth.refreshSession();
  const { data: claimsData } = await client.auth.getClaims();
  const tenantId = claimsData?.claims?.tenant_id as string;
  return { client, userId, tenantId, email };
}

const A_EMAIL = 'it-mut-a@bayou-it.example';
const B_EMAIL = 'it-mut-b@bayou-it.example';
let A: Actor;
let B: Actor;
let productId: string;
let supplier1: string;
let supplier2: string;

beforeAll(async () => {
  A = await makeActor(A_EMAIL, 'Mutation Co A');
  B = await makeActor(B_EMAIL, 'Mutation Co B');

  const p = await A.client
    .from('products')
    .insert({
      tenant_id: A.tenantId,
      sku: 'IT-MUT-1',
      name: 'Integration widget',
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>();
  productId = p.data?.id as string;

  const s1 = await A.client
    .from('suppliers')
    .insert({ tenant_id: A.tenantId, name: 'Source One' })
    .select('id')
    .single<{ id: string }>();
  supplier1 = s1.data?.id as string;
  const s2 = await A.client
    .from('suppliers')
    .insert({ tenant_id: A.tenantId, name: 'Source Two' })
    .select('id')
    .single<{ id: string }>();
  supplier2 = s2.data?.id as string;
}, 60_000);

afterAll(async () => {
  for (const email of [A_EMAIL, B_EMAIL]) {
    const id = await findUserId(email);
    if (id) await admin.auth.admin.deleteUser(id);
  }
  for (const t of [A?.tenantId, B?.tenantId]) {
    if (t) {
      await admin.from('subscriptions').delete().eq('tenant_id', t);
      await admin.from('tenants').delete().eq('id', t);
    }
  }
});

async function primaries(): Promise<string[]> {
  const { data } = await A.client
    .from('product_suppliers')
    .select('supplier_id, is_primary')
    .eq('product_id', productId)
    .returns<{ supplier_id: string; is_primary: boolean }[]>();
  return (data ?? []).filter((r) => r.is_primary).map((r) => r.supplier_id);
}

describe('product + supplier setup', () => {
  it('creates the product and two suppliers under tenant A', () => {
    expect(productId).toBeTruthy();
    expect(supplier1).toBeTruthy();
    expect(supplier2).toBeTruthy();
  });
});

describe('link_supplier RPC — single-primary invariant', () => {
  it('links supplier1 as primary', async () => {
    const { error } = await A.client.rpc('link_supplier', {
      p_product_id: productId,
      p_supplier_id: supplier1,
      p_unit_cost: 1.25,
      p_lead_time_days: 7,
      p_moq: 1,
      p_is_primary: true,
    });
    expect(error).toBeNull();
    expect(await primaries()).toEqual([supplier1]);
  });

  it('linking supplier2 as primary atomically moves the flag (never two primaries)', async () => {
    const { error } = await A.client.rpc('link_supplier', {
      p_product_id: productId,
      p_supplier_id: supplier2,
      p_unit_cost: 2.5,
      p_lead_time_days: 10,
      p_moq: 5,
      p_is_primary: true,
    });
    expect(error).toBeNull();
    expect(await primaries()).toEqual([supplier2]);
  });
});

describe('set_primary_supplier RPC', () => {
  it('moves the primary back to supplier1, still exactly one primary', async () => {
    const { error } = await A.client.rpc('set_primary_supplier', {
      p_product_id: productId,
      p_supplier_id: supplier1,
    });
    expect(error).toBeNull();
    expect(await primaries()).toEqual([supplier1]);
  });
});

describe('cross-tenant isolation', () => {
  it("tenant B sees none of tenant A's product_suppliers", async () => {
    const { data } = await B.client
      .from('product_suppliers')
      .select('product_id')
      .eq('product_id', productId);
    expect(data).toEqual([]);
  });

  it("tenant B cannot set primary on tenant A's product (RPC touches nothing)", async () => {
    await B.client.rpc('set_primary_supplier', {
      p_product_id: productId,
      p_supplier_id: supplier1,
    });
    // Tenant A's primary is unchanged regardless of B's call.
    expect(await primaries()).toEqual([supplier1]);
  });

  it("tenant B cannot archive tenant A's product (update affects 0 rows)", async () => {
    const { data } = await B.client
      .from('products')
      .update({ status: 'discontinued' })
      .eq('id', productId)
      .select('id');
    expect(data ?? []).toEqual([]);
  });
});
