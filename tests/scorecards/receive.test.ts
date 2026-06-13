import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseLeadTime, SCORECARD_MIN_SAMPLE } from '@/lib/policy/compute';
import { receivePurchaseOrder } from '@/lib/scorecards/receive';
import { rollupSupplierScorecards } from '@/lib/scorecards/rollup';

/**
 * PO receipt → supplier_performance → scorecard rollup → empirical lead time
 * (Block 10), against the real local Supabase. Proves: a receipt writes the
 * delivery row + advances the PO; partial then full receipts produce TWO rows;
 * OTIF/on-time/in-full + lead-time avg/stddev land on the scorecard; and once
 * sample_size ≥ 5 the policy's `chooseLeadTime` switches that supplier to the
 * empirical value. Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAIL = 'it-scorecards@bayou-it.example';
const DAY = 24 * 60 * 60 * 1000;

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

/** Create a PO with one line, ordered `daysAgo`, promised `promiseDays` out. */
async function newPo(daysAgo: number, promiseDays: number, qty: number): Promise<string> {
  const createdAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  const { data: po } = await admin
    .from('purchase_orders')
    .insert({
      tenant_id: tenantId,
      supplier_id: supplierId,
      location_id: locationId,
      status: 'sent',
      total: qty * 5,
      expected_delivery_at: new Date(Date.now() - (daysAgo - promiseDays) * DAY).toISOString(),
      created_at: createdAt,
    })
    .select('id')
    .single<{ id: string }>();
  await admin.from('purchase_order_lines').insert({
    tenant_id: tenantId,
    po_id: po?.id,
    line_no: 1,
    product_id: productId,
    ordered_qty: qty,
  });
  return po?.id ?? '';
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email: EMAIL, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'Scorecard Co' });
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
    .insert({ tenant_id: tenantId, name: 'Bayou Freight', contact: {} })
    .select('id')
    .single<{ id: string }>();
  supplierId = sup?.id ?? '';
  const { data: prod } = await admin
    .from('products')
    .insert({ tenant_id: tenantId, sku: 'SC-1', name: 'Test SKU' })
    .select('id')
    .single<{ id: string }>();
  productId = prod?.id ?? '';
  await admin.from('product_suppliers').insert({
    tenant_id: tenantId,
    product_id: productId,
    supplier_id: supplierId,
    is_primary: true,
    lead_time_days: 14,
  });
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('supplier_scorecards').delete().eq('tenant_id', tenantId);
    await admin.from('supplier_performance').delete().eq('tenant_id', tenantId);
    await admin.from('purchase_order_lines').delete().eq('tenant_id', tenantId);
    await admin.from('purchase_orders').delete().eq('tenant_id', tenantId);
    await admin.from('product_suppliers').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('suppliers').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('receivePurchaseOrder + scorecard rollup', () => {
  it('a full on-time receipt advances the PO and lands an OTIF row', async () => {
    const poId = await newPo(10, 8, 50); // ordered 10d ago, promised 2d ago... actually 8d out
    const result = await receivePurchaseOrder(admin, {
      tenantId,
      poId,
      // delivered before the promise → on time
      actualDeliveryAt: new Date(Date.now() - 3 * DAY).toISOString(),
      lines: [{ lineNo: 1, receivedQty: 50 }],
    });
    expect(result).toMatchObject({ ok: true, status: 'received' });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('status, actual_delivery_at')
      .eq('id', poId)
      .single<{ status: string; actual_delivery_at: string | null }>();
    expect(po?.status).toBe('received');
    expect(po?.actual_delivery_at).toBeTruthy();

    const { data: perf } = await admin
      .from('supplier_performance')
      .select('on_time, in_full, on_time_in_full, po_id')
      .eq('po_id', poId)
      .single<{ on_time: boolean; in_full: boolean; on_time_in_full: boolean }>();
    expect(perf).toMatchObject({ on_time: true, in_full: true, on_time_in_full: true });

    const { data: card } = await admin
      .from('supplier_scorecards')
      .select('otif_pct, sample_size, lead_time_avg_days')
      .eq('supplier_id', supplierId)
      .eq('window_kind', 'rolling_30d')
      .single<{ otif_pct: number; sample_size: number; lead_time_avg_days: number }>();
    expect(Number(card?.otif_pct)).toBe(1);
    expect(card?.sample_size).toBe(1);
    expect(Number(card?.lead_time_avg_days)).toBeGreaterThan(0);
  });

  it('partial then full receipt records the PER-EVENT quantity on each row', async () => {
    // Ordered 12d ago, promised 4d ago (12 − 8). Both receipts land before the
    // promise so timing is clean and the verdict turns on the QUANTITY.
    const poId = await newPo(12, 8, 100);
    const r1 = await receivePurchaseOrder(admin, {
      tenantId,
      poId,
      actualDeliveryAt: new Date(Date.now() - 6 * DAY).toISOString(),
      lines: [{ lineNo: 1, receivedQty: 60 }],
    });
    expect(r1).toMatchObject({ ok: true, status: 'partial_received' });
    const r2 = await receivePurchaseOrder(admin, {
      tenantId,
      poId,
      actualDeliveryAt: new Date(Date.now() - 5 * DAY).toISOString(),
      lines: [{ lineNo: 1, receivedQty: 40 }],
    });
    expect(r2).toMatchObject({ ok: true, status: 'received' });

    const { data: rows } = await admin
      .from('supplier_performance')
      .select('actual_quantity, in_full, on_time_in_full, recorded_at')
      .eq('po_id', poId)
      .order('recorded_at')
      .returns<
        { actual_quantity: string | number; in_full: boolean; on_time_in_full: boolean }[]
      >();
    expect(rows).toHaveLength(2); // FEATURES: two delivery dates → two rows

    // Codex round-1 bug: the per-event quantity, NOT the cumulative total.
    const first = rows?.[0];
    const second = rows?.[1];
    expect(Number(first?.actual_quantity)).toBe(60); // this event delivered 60
    expect(first?.in_full).toBe(false); // order not complete after 60/100
    expect(first?.on_time_in_full).toBe(false);
    expect(Number(second?.actual_quantity)).toBe(40); // NOT 100
    expect(second?.in_full).toBe(true); // 40 completes the order
    expect(second?.on_time_in_full).toBe(true); // on time + now in full
  });

  it('refuses to receive an already-closed PO', async () => {
    const poId = await newPo(9, 7, 10);
    await receivePurchaseOrder(admin, {
      tenantId,
      poId,
      actualDeliveryAt: new Date().toISOString(),
      lines: [{ lineNo: 1, receivedQty: 10 }],
    });
    const again = await receivePurchaseOrder(admin, {
      tenantId,
      poId,
      actualDeliveryAt: new Date().toISOString(),
      lines: [{ lineNo: 1, receivedQty: 10 }],
    });
    expect(again).toMatchObject({ ok: false });
  });

  it('once sample_size ≥ 5, chooseLeadTime switches to the empirical scorecard', async () => {
    // We already have ≥3 performance rows; top up past the threshold.
    for (let i = 0; i < 4; i++) {
      const poId = await newPo(20 + i, 8, 25);
      await receivePurchaseOrder(admin, {
        tenantId,
        poId,
        actualDeliveryAt: new Date(Date.now() - (10 + i) * DAY).toISOString(),
        lines: [{ lineNo: 1, receivedQty: 25 }],
      });
    }
    const sample = await rollupSupplierScorecards(admin, tenantId, supplierId);
    expect(sample).toBeGreaterThanOrEqual(SCORECARD_MIN_SAMPLE);

    const { data: card } = await admin
      .from('supplier_scorecards')
      .select('lead_time_avg_days, lead_time_stddev_days, sample_size')
      .eq('supplier_id', supplierId)
      .eq('window_kind', 'all_time')
      .single<{ lead_time_avg_days: number; lead_time_stddev_days: number; sample_size: number }>();

    // The policy lead-time chooser now prefers the empirical value over the
    // configured 14 days, with the realized stddev as σ_L.
    const choice = chooseLeadTime(14, {
      avgDays: Number(card?.lead_time_avg_days),
      stddevDays: Number(card?.lead_time_stddev_days),
      sampleSize: card?.sample_size ?? 0,
    });
    expect(choice?.source).toBe('scorecard');
    expect(choice?.days).toBeCloseTo(Number(card?.lead_time_avg_days), 5);
  });
});
