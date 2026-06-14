import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getForecastInsight, getReorderInsight } from '@/lib/insights/generate';
import { PROMPT_VERSION } from '@/lib/insights/prompts';

/**
 * Insight cache path (Block 12) against the real local Supabase. A pre-cached
 * insight is served WITHOUT a model call (cached=true), idempotent on
 * (tenant, entity_type, entity_id, prompt_version). The cache-MISS → model-call
 * path needs the AI Gateway key and is verified live in the browser. Requires
 * `supabase start`.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = 'it-insights@bayou-it.example';
const PO_ID = '00000000-0000-4000-8000-0000000c1212';

let tenantId: string;

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
  await client.rpc('bootstrap_tenant', { p_business_name: 'Insights Co' });
  await client.auth.refreshSession();
  const { data } = await client.auth.getClaims();
  tenantId = data?.claims?.tenant_id as string;
}, 60_000);

afterAll(async () => {
  if (tenantId) {
    await admin.from('insights').delete().eq('tenant_id', tenantId);
    await admin.from('forecasts').delete().eq('tenant_id', tenantId);
    await admin.from('products').delete().eq('tenant_id', tenantId);
    await admin.from('subscriptions').delete().eq('tenant_id', tenantId);
    await admin.from('tenants').delete().eq('id', tenantId);
  }
  const id = await findUserId(EMAIL);
  if (id) await admin.auth.admin.deleteUser(id);
});

describe('getReorderInsight — cache path', () => {
  it('serves a pre-cached insight without a model call', async () => {
    await admin.from('insights').insert({
      tenant_id: tenantId,
      entity_type: 'purchase_order',
      entity_id: PO_ID,
      model: 'anthropic/claude-sonnet-4.6',
      prompt_version: PROMPT_VERSION,
      content: {
        text: 'BLT-200 fell to 3 units against its 20 reorder point; 47 rebuilds the cover.',
      },
      confidence: 0.88,
    });

    const res = await getReorderInsight(admin, tenantId, PO_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insight.cached).toBe(true);
    expect(res.insight.content).toMatch(/BLT-200/);
    expect(res.insight.confidence).toBeCloseTo(0.88, 5);
    expect(res.insight.model).toBe('anthropic/claude-sonnet-4.6');
    expect(res.insight.promptVersion).toBe(PROMPT_VERSION);
  });
});

describe('getForecastInsight — cache path', () => {
  const PRODUCT_ID = '00000000-0000-4000-8000-0000000f0001';
  const FORECAST_ID = '00000000-0000-4000-8000-0000000f0002';

  it('resolves the latest forecast and serves its cached insight without a model call', async () => {
    await admin.from('products').insert({
      tenant_id: tenantId,
      id: PRODUCT_ID,
      sku: 'FCT-900',
      name: 'Forecast Test Widget',
    });
    await admin.from('forecasts').insert({
      tenant_id: tenantId,
      id: FORECAST_ID,
      product_id: PRODUCT_ID,
      aggregation_level: 'sku',
      method: 'auto_ets',
      horizon_days: 56,
      run_id: '00000000-0000-4000-8000-0000000f0003',
    });
    // Insight keyed on the FORECAST id (busts on recompute), not the product id.
    await admin.from('insights').insert({
      tenant_id: tenantId,
      entity_type: 'forecast',
      entity_id: FORECAST_ID,
      model: 'anthropic/claude-sonnet-4.6',
      prompt_version: PROMPT_VERSION,
      content: { text: 'FCT-900 demand holds near 12 units a week with a tight band.' },
      confidence: 0.9,
    });

    const res = await getForecastInsight(admin, tenantId, PRODUCT_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.insight.cached).toBe(true);
    expect(res.insight.content).toMatch(/FCT-900/);
    expect(res.insight.confidence).toBeCloseTo(0.9, 5);
    expect(res.insight.promptVersion).toBe(PROMPT_VERSION);
  });

  it('returns a friendly error when the SKU has no forecast', async () => {
    const res = await getForecastInsight(admin, tenantId, '00000000-0000-4000-8000-0000000f00ff');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/no forecast/i);
  });
});
