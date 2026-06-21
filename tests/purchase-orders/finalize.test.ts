import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeReceivedPurchaseOrder } from '@/lib/purchase-orders/finalize';

/**
 * Post-receipt finalize (Block 11b) against the real local Supabase. The
 * lifecycle workflow's terminal step: it reads the PO's status to confirm the
 * order actually reached `received` (and returns null for an unknown PO without
 * throwing, so a stray hook can't wedge the durable run). Requires `supabase
 * start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-finalize@bayou-it.example';

let tenantId: string;
let supplierId: string;
let locationId: string;

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
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
  await client.rpc('bootstrap_tenant', { p_business_name: 'Finalize Co' });
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
    .insert({ tenant_id: tenantId, name: 'Fin Vendor', contact: {} })
    .select('id')
    .single<{ id: string }>();
  supplierId = sup?.id ?? '';
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('purchase_orders').delete().eq('tenant_id', tenantId);
    await admin.from('suppliers').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('finalizeReceivedPurchaseOrder', () => {
  it('returns the received status for a completed PO', async () => {
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        tenant_id: tenantId,
        supplier_id: supplierId,
        location_id: locationId,
        status: 'received',
      })
      .select('id')
      .single<{ id: string }>();

    const result = await finalizeReceivedPurchaseOrder(admin, tenantId, po?.id ?? '');
    expect(result).toEqual({ status: 'received' });
  });

  it('returns null for an unknown PO without throwing (a stray hook is harmless)', async () => {
    const result = await finalizeReceivedPurchaseOrder(
      admin,
      tenantId,
      '00000000-0000-4000-8000-0000000000ff',
    );
    expect(result).toEqual({ status: null });
  });
});
