import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveAndPushPurchaseOrder } from '@/lib/purchase-orders/approve-core';

/**
 * PO approval against the real local Supabase (Block 11b). With no QBO
 * connection (and no `external_ids->>'qbo'` on the supplier/products), approval
 * takes the manual EXPORTED path: status advances draft → exported and the
 * ordered quantity is committed as `inventory_levels.in_transit`. Re-approving
 * is idempotent (no second in-transit increment). Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-approve@bayou-it.example';

let tenantId: string;
let supplierId: string;
let locationId: string;
let productId: string;

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

/** A draft PO with one line of `qty` at `cost`. */
async function newDraftPo(qty: number, cost: number): Promise<string> {
  const { data: po } = await admin
    .from('purchase_orders')
    .insert({
      tenant_id: tenantId,
      supplier_id: supplierId,
      location_id: locationId,
      status: 'draft',
      recommended_by: 'system',
      total: qty * cost,
    })
    .select('id')
    .single<{ id: string }>();
  await admin.from('purchase_order_lines').insert({
    tenant_id: tenantId,
    po_id: po?.id,
    line_no: 1,
    product_id: productId,
    ordered_qty: qty,
    unit_cost: cost,
  });
  return po?.id ?? '';
}

async function inTransit(): Promise<number> {
  const { data } = await admin
    .from('inventory_levels')
    .select('in_transit')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle<{ in_transit: number }>();
  return Number(data?.in_transit ?? 0);
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({
    email: EMAIL,
    password: 'integration-pw',
    email_confirm: true,
  });
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'Approve Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;

  const { data: loc } = await admin
    .from('locations')
    .insert({ tenant_id: tenantId, name: 'DC', type: 'warehouse' })
    .select('id')
    .single<{ id: string }>();
  locationId = loc?.id ?? '';
  const { data: sup } = await admin
    .from('suppliers')
    .insert({ tenant_id: tenantId, name: 'Manual Vendor', contact: {} })
    .select('id')
    .single<{ id: string }>();
  supplierId = sup?.id ?? '';
  const { data: prod } = await admin
    .from('products')
    .insert({ tenant_id: tenantId, sku: 'AP-1', name: 'Approve SKU' })
    .select('id')
    .single<{ id: string }>();
  productId = prod?.id ?? '';
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('purchase_order_lines').delete().eq('tenant_id', tenantId);
    await admin.from('purchase_orders').delete().eq('tenant_id', tenantId);
    await admin.from('inventory_levels').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('suppliers').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('approveAndPushPurchaseOrder', () => {
  it('with no QBO connection, approves to EXPORTED and commits in-transit', async () => {
    const poId = await newDraftPo(40, 5);
    const before = await inTransit();
    const res = await approveAndPushPurchaseOrder(admin, { tenantId, poId, nowMs: Date.now() });
    expect(res).toMatchObject({ ok: true, status: 'exported', applied: true, wroteToQbo: false });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('status')
      .eq('id', poId)
      .single<{ status: string }>();
    expect(po?.status).toBe('exported');
    expect(await inTransit()).toBe(before + 40);
  });

  it('re-approving is a no-op (no second in-transit increment)', async () => {
    const poId = await newDraftPo(25, 5);
    await approveAndPushPurchaseOrder(admin, { tenantId, poId, nowMs: Date.now() });
    const afterFirst = await inTransit();

    const replay = await approveAndPushPurchaseOrder(admin, { tenantId, poId, nowMs: Date.now() });
    // The PO is past draft now → the core refuses before touching the RPC.
    expect(replay.ok).toBe(false);
    expect(await inTransit()).toBe(afterFirst);
  });
});
