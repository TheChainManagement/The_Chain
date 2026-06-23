import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApproveDeps, approveAndPushPurchaseOrder } from '@/lib/purchase-orders/approve-core';
import { poDocNumber } from '@/lib/qbo/map';

/**
 * PO approval against the real local Supabase (Block 11b).
 *
 * EXPORTED path: with no QBO connection (or any supplier/product lacking an
 * `external_ids->>'qbo'`), approval advances draft → exported and commits the
 * ordered quantity as `inventory_levels.in_transit`. Re-approving is idempotent.
 *
 * SENT path: when the supplier AND every line carry a `qbo` external id and a
 * QBO connection exists, approval pushes the PO back to QuickBooks first, then
 * advances draft → sent and persists the returned entity id + DocNumber. The
 * QBO adapter factory is seamed via `ApproveDeps.createAdapter` so the connected
 * write-back is exercised without a live Intuit connection. A push failure
 * degrades to the exported path so approval still commits. Requires `supabase start`.
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
let mappedSupplierId: string;
let mappedProductId: string;

const QBO_PO_ID = 'qbo-po-7788';
const QBO_SYNC_TOKEN = 4;

/** A fake QBO factory whose adapter push succeeds, returning a stable entity. */
const sentDeps: ApproveDeps = {
  createAdapter: async () => ({
    adapter: {
      push: async () => ({
        externalId: QBO_PO_ID,
        externalVersion: QBO_SYNC_TOKEN,
        appliedAt: '2026-06-23T00:00:00.000Z',
      }),
    },
  }),
};

/** A connected factory whose push throws — must degrade to the exported path. */
const pushFailsDeps: ApproveDeps = {
  createAdapter: async () => ({
    adapter: {
      push: async () => {
        throw new Error('QBO unreachable');
      },
    },
  }),
};

/** Mapped supplier + SKU, but no connection (factory returns null) → exported. */
const noConnectionDeps: ApproveDeps = { createAdapter: async () => null };

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

/** A draft PO with one line of `qty` at `cost` against the given supplier/SKU. */
async function newDraftPo(
  qty: number,
  cost: number,
  supplier = supplierId,
  product = productId,
): Promise<string> {
  const { data: po } = await admin
    .from('purchase_orders')
    .insert({
      tenant_id: tenantId,
      supplier_id: supplier,
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
    product_id: product,
    ordered_qty: qty,
    unit_cost: cost,
  });
  return po?.id ?? '';
}

/** A draft PO whose supplier + SKU both carry `external_ids.qbo` (write-back eligible). */
function newMappedDraftPo(qty: number, cost: number): Promise<string> {
  return newDraftPo(qty, cost, mappedSupplierId, mappedProductId);
}

async function inTransit(product = productId): Promise<number> {
  const { data } = await admin
    .from('inventory_levels')
    .select('in_transit')
    .eq('tenant_id', tenantId)
    .eq('product_id', product)
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

  // A QBO-mapped supplier + SKU (both carry external_ids.qbo) → write-back eligible.
  const { data: mSup } = await admin
    .from('suppliers')
    .insert({
      tenant_id: tenantId,
      name: 'QBO Vendor',
      contact: {},
      external_ids: { qbo: '55' },
    })
    .select('id')
    .single<{ id: string }>();
  mappedSupplierId = mSup?.id ?? '';
  const { data: mProd } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      sku: 'AP-2',
      name: 'QBO SKU',
      external_ids: { qbo: '101' },
    })
    .select('id')
    .single<{ id: string }>();
  mappedProductId = mProd?.id ?? '';
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

  it('mapped + connected: pushes to QBO, advances to SENT, persists the entity id', async () => {
    const poId = await newMappedDraftPo(30, 7);
    const before = await inTransit(mappedProductId);

    const res = await approveAndPushPurchaseOrder(
      admin,
      { tenantId, poId, nowMs: Date.now() },
      sentDeps,
    );
    expect(res).toMatchObject({
      ok: true,
      status: 'sent',
      applied: true,
      wroteToQbo: true,
      reference: poDocNumber(poId),
    });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('status, external_po_id, external_reference')
      .eq('id', poId)
      .single<{
        status: string;
        external_po_id: string | null;
        external_reference: string | null;
      }>();
    expect(po?.status).toBe('sent');
    expect(po?.external_po_id).toBe(QBO_PO_ID);
    expect(po?.external_reference).toBe(poDocNumber(poId));
    // The ordered quantity is still committed as in-transit on the sent path.
    expect(await inTransit(mappedProductId)).toBe(before + 30);
  });

  it('mapped but QBO push fails: degrades to EXPORTED, still commits in-transit', async () => {
    const poId = await newMappedDraftPo(12, 7);
    const before = await inTransit(mappedProductId);

    const res = await approveAndPushPurchaseOrder(
      admin,
      { tenantId, poId, nowMs: Date.now() },
      pushFailsDeps,
    );
    expect(res).toMatchObject({ ok: true, status: 'exported', applied: true, wroteToQbo: false });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('status, external_po_id')
      .eq('id', poId)
      .single<{ status: string; external_po_id: string | null }>();
    expect(po?.status).toBe('exported');
    expect(po?.external_po_id).toBeNull();
    expect(await inTransit(mappedProductId)).toBe(before + 12);
  });

  it('mapped but not connected: takes the EXPORTED path (no adapter handle)', async () => {
    const poId = await newMappedDraftPo(8, 7);

    const res = await approveAndPushPurchaseOrder(
      admin,
      { tenantId, poId, nowMs: Date.now() },
      noConnectionDeps,
    );
    expect(res).toMatchObject({ ok: true, status: 'exported', wroteToQbo: false });
  });
});
