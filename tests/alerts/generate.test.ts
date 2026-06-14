import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAlertGeneration } from '@/lib/alerts/generate';

/**
 * Alert generation against the real local Supabase (in-app alerts engine). The
 * FEATURES acceptance criteria + Codex checklist for the dedupe contract:
 *   - same condition firing repeatedly → exactly ONE open alert (no spam),
 *   - severity rise → a NEW open row with reopen_count+1, prior superseded,
 *   - condition clears → auto_closed,
 *   - re-run on unchanged data → held (idempotent).
 * Requires `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAIL = 'it-alerts@bayou-it.example';

let tenantId: string;
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

/** Set the stockout risk score on the product's policy (creates the row once). */
async function setStockoutScore(score: number): Promise<void> {
  const { error } = await admin.from('inventory_policy').upsert({
    tenant_id: tenantId,
    product_id: productId,
    location_id: locationId,
    stockout_risk_score: score,
    days_of_supply: 6,
    reorder_point: 20,
    service_level: 0.95,
    lead_time_days_used: 7,
  });
  if (error) throw new Error(`seed policy failed: ${error.message}`);
}

async function openAlerts(kind: string) {
  const { data } = await admin
    .from('alerts')
    .select('id, severity, reopen_count, status, dedupe_key')
    .eq('tenant_id', tenantId)
    .eq('kind', kind)
    .eq('status', 'open')
    .returns<{ id: string; severity: string; reopen_count: number; status: string }[]>();
  return data ?? [];
}

async function allAlerts(kind: string) {
  const { data } = await admin
    .from('alerts')
    .select('status, severity, reopen_count')
    .eq('tenant_id', tenantId)
    .eq('kind', kind)
    .returns<{ status: string; severity: string; reopen_count: number }[]>();
  return data ?? [];
}

beforeAll(async () => {
  const existing = await findUserId(EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing);
  await admin.auth.admin.createUser({ email: EMAIL, password: 'integration-pw', email_confirm: true });
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  await client.auth.signInWithPassword({ email: EMAIL, password: 'integration-pw' });
  await client.rpc('bootstrap_tenant', { p_business_name: 'Alerts Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;

  const { data: loc } = await admin
    .from('locations')
    .insert({ tenant_id: tenantId, name: 'DC', type: 'warehouse' })
    .select('id')
    .single<{ id: string }>();
  locationId = loc?.id ?? '';
  const { data: prod } = await admin
    .from('products')
    .insert({ tenant_id: tenantId, sku: 'AL-1', name: 'Alert SKU' })
    .select('id')
    .single<{ id: string }>();
  productId = prod?.id ?? '';
}, 60_000);

beforeEach(async () => {
  // Clean slate of alerts between tests; keep the tenant + catalog.
  await admin.from('alerts').delete().eq('tenant_id', tenantId);
});

afterAll(async () => {
  if (tenantId) {
    await admin.from('alerts').delete().eq('tenant_id', tenantId);
    await admin.from('inventory_policy').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('locations').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('runAlertGeneration — dedupe contract', () => {
  it('the same condition firing three times yields exactly ONE open alert', async () => {
    await setStockoutScore(0.5); // warn-level stockout risk, no reorder rec
    for (let i = 0; i < 3; i++) await runAlertGeneration(admin, tenantId, Date.now());
    const open = await openAlerts('stockout_risk');
    expect(open).toHaveLength(1);
    expect(open[0]?.reopen_count).toBe(0); // held, never escalated
  });

  it('a severity RISE opens a new row with reopen_count+1 and supersedes the prior', async () => {
    await setStockoutScore(0.3); // info
    const r1 = await runAlertGeneration(admin, tenantId, Date.now());
    expect(r1.created).toBe(1);
    await setStockoutScore(0.5); // info → warn
    const r2 = await runAlertGeneration(admin, tenantId, Date.now());
    expect(r2.escalated).toBe(1);
    await setStockoutScore(0.8); // warn → critical
    const r3 = await runAlertGeneration(admin, tenantId, Date.now());
    expect(r3.escalated).toBe(1);

    const open = await openAlerts('stockout_risk');
    expect(open).toHaveLength(1); // the unique partial index holds
    expect(open[0]?.severity).toBe('critical');
    expect(open[0]?.reopen_count).toBe(2); // escalated twice

    const all = await allAlerts('stockout_risk');
    expect(all.filter((a) => a.status === 'superseded')).toHaveLength(2);
    expect(all.filter((a) => a.status === 'open')).toHaveLength(1);
  });

  it('a severity HOLD or DROP does not open a new row', async () => {
    await setStockoutScore(0.8); // critical
    await runAlertGeneration(admin, tenantId, Date.now());
    await setStockoutScore(0.5); // drops to warn — still open, no new row
    const r = await runAlertGeneration(admin, tenantId, Date.now());
    expect(r.escalated).toBe(0);
    expect(r.held).toBe(1);
    const open = await openAlerts('stockout_risk');
    expect(open).toHaveLength(1);
    expect(open[0]?.severity).toBe('critical'); // severity never downgrades the live row
  });

  it('auto-closes the alert when the condition clears', async () => {
    await setStockoutScore(0.6);
    await runAlertGeneration(admin, tenantId, Date.now());
    expect(await openAlerts('stockout_risk')).toHaveLength(1);

    await setStockoutScore(0.05); // below the info floor → condition cleared
    const r = await runAlertGeneration(admin, tenantId, Date.now());
    expect(r.closed).toBe(1);
    expect(await openAlerts('stockout_risk')).toHaveLength(0);
    const all = await allAlerts('stockout_risk');
    expect(all.some((a) => a.status === 'auto_closed')).toBe(true);
  });
});
