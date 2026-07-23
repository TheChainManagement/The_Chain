import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertRecommendationsToPurchaseRequest } from '@/lib/reorder/convert';
import { generateReorderRecommendations } from '@/lib/reorder/generate';
import { loadReorderQueue } from '@/lib/reorder/queue';

/**
 * Reorder generation + convert (Block 11) against the real local Supabase.
 * Proves: a breach (position ≤ reorder point) writes an open recommendation
 * with reason; recovery expires it; regeneration updates in place (no dupes);
 * and conversion submits a same-supplier set through the requisition authority
 * policy before any PO exists. Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-reorder@bayou-it.example';

let tenantId: string;
let supplierId: string;
let locationId: string;
let userId: string;
let memberClient: SupabaseClient;
const productIds = {} as Record<'breached' | 'healthy' | 'stockout', string>;

async function findUserId(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return undefined;
}

/** Seed a SKU with a policy (reorder point) and an on-hand position. */
async function seedSku(
  sku: string,
  reorderPoint: number,
  position: number,
  roq: number,
): Promise<string> {
  const { data: p } = await admin
    .from('products')
    .insert({ tenant_id: tenantId, sku, name: `Bayou ${sku}`, primary_supplier_id: supplierId })
    .select('id')
    .single<{ id: string }>();
  const pid = p?.id ?? '';
  await admin.from('product_suppliers').insert({
    tenant_id: tenantId,
    product_id: pid,
    supplier_id: supplierId,
    is_primary: true,
    unit_cost: 5,
    lead_time_days: 9,
  });
  await admin.from('inventory_levels').insert({
    tenant_id: tenantId,
    product_id: pid,
    location_id: locationId,
    on_hand: position,
    allocated: 0,
    in_transit: 0,
  });
  await admin.from('inventory_policy').insert({
    tenant_id: tenantId,
    product_id: pid,
    location_id: locationId,
    lead_time_days_used: 9,
    reorder_point: reorderPoint,
    safety_stock: 12,
    recommended_order_qty: roq,
    days_of_supply: position / 5,
  });
  return pid;
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({
    email: EMAIL,
    password: 'integration-pw',
    email_confirm: true,
  });
  memberClient = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await memberClient.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await memberClient.rpc('bootstrap_tenant', { p_business_name: 'Reorder Co' });
  await memberClient.auth.refreshSession();
  const { data } = await memberClient.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;
  userId = data?.claims?.sub as string;

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

  productIds.breached = await seedSku('RO-1', 57, 40, 280); // below reorder point
  productIds.healthy = await seedSku('RO-2', 30, 90, 50); // above
  productIds.stockout = await seedSku('RO-3', 20, 0, 100); // out of stock
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('purchase_order_lines').delete().eq('tenant_id', tenantId);
    await admin.from('purchase_orders').delete().eq('tenant_id', tenantId);
    await admin.from('requisition_lines').delete().eq('tenant_id', tenantId);
    await admin.from('requisitions').delete().eq('tenant_id', tenantId);
    await admin.from('reorder_recommendations').delete().eq('tenant_id', tenantId);
    await admin.from('inventory_policy').delete().eq('tenant_id', tenantId);
    await admin.from('inventory_levels').delete().eq('tenant_id', tenantId);
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

describe('generateReorderRecommendations', () => {
  it('writes open recommendations only for breached SKUs, with reason', async () => {
    const summary = await generateReorderRecommendations(admin, { tenantId });
    expect(summary.open).toBe(2); // breached + stockout, not healthy
    expect(summary.created).toBe(2);

    const { data: recs } = await admin
      .from('reorder_recommendations')
      .select('product_id, recommended_qty, reason, status, supplier_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .returns<
        {
          product_id: string;
          recommended_qty: string | number;
          reason: { position: number; reorderPoint: number };
          supplier_id: string;
        }[]
      >();
    expect(recs).toHaveLength(2);
    const breached = recs?.find((r) => r.product_id === productIds.breached);
    expect(Number(breached?.recommended_qty)).toBe(280);
    expect(breached?.reason).toMatchObject({ position: 40, reorderPoint: 57 });
    expect(breached?.supplier_id).toBe(supplierId);
    expect(recs?.some((r) => r.product_id === productIds.healthy)).toBe(false);
  });

  it('regeneration updates in place (no duplicate rows), bumping version', async () => {
    await generateReorderRecommendations(admin, { tenantId });
    const { data: recs } = await admin
      .from('reorder_recommendations')
      .select('id, version')
      .eq('tenant_id', tenantId)
      .eq('product_id', productIds.breached)
      .eq('status', 'open')
      .returns<{ id: string; version: number }[]>();
    expect(recs).toHaveLength(1); // not stacked
    expect(recs?.[0]?.version).toBeGreaterThanOrEqual(2);
  });

  it('expires the open recommendation when the SKU recovers', async () => {
    await admin
      .from('inventory_levels')
      .update({ on_hand: 200 })
      .eq('product_id', productIds.breached);
    const summary = await generateReorderRecommendations(admin, {
      tenantId,
      productIds: [productIds.breached],
    });
    expect(summary.expired).toBe(1);
    const { count } = await admin
      .from('reorder_recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productIds.breached)
      .eq('status', 'open');
    expect(count).toBe(0);
  });

  it('default spend policy queues a requisition and creates no PO', async () => {
    // The stockout SKU is still open; add its id.
    const { data: open } = await admin
      .from('reorder_recommendations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .returns<{ id: string }[]>();
    const ids = (open ?? []).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);

    const res = await convertRecommendationsToPurchaseRequest(memberClient, {
      tenantId,
      recommendationIds: ids,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({
      approvalStatus: 'submitted',
      reason: 'approval_required_by_policy',
      autoApproved: false,
      poId: null,
    });

    const { data: requisition } = await admin
      .from('requisitions')
      .select('status, requested_by_user_id, approval_reason')
      .eq('id', res.requisitionId)
      .single<{
        status: string;
        requested_by_user_id: string;
        approval_reason: string;
      }>();
    expect(requisition).toMatchObject({
      status: 'submitted',
      requested_by_user_id: userId,
      approval_reason: 'approval_required_by_policy',
    });

    const { count: poCount } = await admin
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('requisition_id', res.requisitionId);
    expect(poCount).toBe(0);

    // The recommendations are now converted (can't be re-converted).
    const again = await convertRecommendationsToPurchaseRequest(memberClient, {
      tenantId,
      recommendationIds: ids,
    });
    expect(again.ok).toBe(false);
  });

  it('auto-approved reorder request creates an approvable linked PO end to end', async () => {
    await admin.from('inventory_levels').update({ on_hand: 0 }).eq('product_id', productIds.healthy);
    await generateReorderRecommendations(admin, {
      tenantId,
      productIds: [productIds.healthy],
    });
    const { data: open } = await admin
      .from('reorder_recommendations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('product_id', productIds.healthy)
      .eq('status', 'open')
      .returns<{ id: string }[]>();
    const ids = (open ?? []).map((row) => row.id);
    expect(ids).toHaveLength(1);

    const { error: authorityError } = await memberClient.rpc('set_member_requisition_authority', {
      p_tenant: tenantId,
      p_member: userId,
      p_requester_mode: 'auto_approve_to_limit',
      p_requester_limit: 250,
      p_approver_limit: null,
    });
    expect(authorityError).toBeNull();
    const res = await convertRecommendationsToPurchaseRequest(memberClient, {
      tenantId,
      recommendationIds: ids,
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.poId) return;
    expect(res).toMatchObject({
      approvalStatus: 'approved',
      reason: 'within_requester_limit',
      autoApproved: true,
    });

    const { data: po } = await admin
      .from('purchase_orders')
      .select('status, requisition_id')
      .eq('id', res.poId)
      .single<{ status: string; requisition_id: string }>();
    expect(po).toEqual({ status: 'draft', requisition_id: res.requisitionId });

    const { data: approved, error } = await admin.rpc('apply_po_approval', {
      p_tenant: tenantId,
      p_po: res.poId,
      p_target_status: 'exported',
    });
    expect(error).toBeNull();
    expect(approved?.[0]).toMatchObject({ out_status: 'exported', out_applied: true });
  });

  it('partitions by location: same supplier + two locations cannot be co-converted', async () => {
    // A second location for the same supplier + product, both breached.
    const { data: loc2 } = await admin
      .from('locations')
      .insert({ tenant_id: tenantId, name: 'Yard 2', type: 'warehouse' })
      .select('id')
      .single<{ id: string }>();
    const loc2Id = loc2?.id ?? '';
    await admin.from('inventory_levels').insert({
      tenant_id: tenantId,
      product_id: productIds.stockout,
      location_id: loc2Id,
      on_hand: 2,
      allocated: 0,
      in_transit: 0,
    });
    await admin.from('inventory_policy').insert({
      tenant_id: tenantId,
      product_id: productIds.stockout,
      location_id: loc2Id,
      lead_time_days_used: 9,
      reorder_point: 20,
      safety_stock: 12,
      recommended_order_qty: 100,
      days_of_supply: 0.4,
    });

    await generateReorderRecommendations(admin, { tenantId });

    // The queue must present TWO groups for the one supplier (one per location).
    const queue = await loadReorderQueue(admin);
    const stockoutGroups = queue.filter((g) =>
      g.rows.some((r) => r.productId === productIds.stockout),
    );
    expect(stockoutGroups.length).toBe(2);
    expect(new Set(stockoutGroups.map((g) => g.locationId)).size).toBe(2);

    // A cross-location set is rejected by the convert contract.
    const crossIds = stockoutGroups.flatMap((g) => g.rows.map((r) => r.id));
    const res = await convertRecommendationsToPurchaseRequest(memberClient, {
      tenantId,
      recommendationIds: crossIds,
    });
    expect(res.ok).toBe(false);
  });
});
