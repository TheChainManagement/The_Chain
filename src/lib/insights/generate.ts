/**
 * Insight generation core (Block 12 — AI insights layer) — server-only.
 *
 * Lazy + cached: the first view of an entity generates the insight; every later
 * view serves it from the `insights` table (idempotent on
 * `(tenant_id, entity_type, entity_id, prompt_version)`). The LLM is the
 * interpreter — it receives validated structured facts and returns prose; the
 * confidence is DATA-driven (computed from fact completeness here), never the
 * model's self-report, so a number never originates in the model.
 *
 * The Claude call routes through Vercel AI Gateway with a model-fallback chain,
 * so a primary-provider outage degrades to the next model rather than failing
 * the panel (FEATURES Codex checklist). Token usage is logged per call for the
 * cost-monitoring counter.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APICallError, gateway, generateText } from 'ai';
import { buildReorderPrompt, type InsightKind, PROMPT_VERSION, type ReorderFacts } from './prompts';

const PRIMARY_MODEL = 'anthropic/claude-sonnet-4.6';
const FALLBACK_MODELS = ['anthropic/claude-haiku-4.5', 'openai/gpt-5.4'];

export interface InsightView {
  content: string;
  confidence: number;
  model: string;
  promptVersion: string;
  /** Whether this came from cache (no model call). */
  cached: boolean;
}

export type InsightResult = { ok: true; insight: InsightView } | { ok: false; error: string };

const ENTITY_TYPE: Record<InsightKind, string> = {
  reorder: 'purchase_order',
  forecast: 'forecast',
};

/**
 * The "Why this reorder" insight for a purchase order. Caches on first view.
 */
export async function getReorderInsight(
  admin: SupabaseClient,
  tenantId: string,
  poId: string,
): Promise<InsightResult> {
  const cached = await readCachedInsight(admin, tenantId, 'reorder', poId);
  if (cached) return { ok: true, insight: cached };

  const facts = await assembleReorderFacts(admin, tenantId, poId);
  if (!facts) return { ok: false, error: 'That order was not found.' };

  const confidence = reorderConfidence(facts);
  const { system, prompt } = buildReorderPrompt(facts);

  const generated = await callModel({ system, prompt, kind: 'reorder', tenantId });
  if (!generated.ok) return generated;

  const insight: InsightView = {
    content: generated.text,
    confidence,
    model: generated.model,
    promptVersion: PROMPT_VERSION,
    cached: false,
  };
  await cacheInsight(admin, tenantId, 'reorder', poId, insight);
  return { ok: true, insight };
}

// ----- model call (gateway + fallback) -----

interface ModelOk {
  ok: true;
  text: string;
  model: string;
}

async function callModel(input: {
  system: string;
  prompt: string;
  kind: InsightKind;
  tenantId: string;
}): Promise<ModelOk | { ok: false; error: string }> {
  try {
    const { text, usage, response } = await generateText({
      model: gateway(PRIMARY_MODEL),
      system: input.system,
      prompt: input.prompt,
      temperature: 0.3,
      maxOutputTokens: 200,
      providerOptions: {
        gateway: {
          // Degrade to the next model rather than failing the panel.
          models: FALLBACK_MODELS,
          tags: ['feature:insight', `kind:${input.kind}`],
          user: input.tenantId,
        },
      },
    });
    const clean = text.trim();
    if (!clean) return { ok: false, error: 'empty' };
    const model = response?.modelId ?? PRIMARY_MODEL;
    console.log(
      `[insight] kind=${input.kind} tenant=${input.tenantId} model=${model} ` +
        `tokens=${usage?.totalTokens ?? '?'} (in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'})`,
    );
    return { ok: true, text: clean, model };
  } catch (err) {
    if (APICallError.isInstance(err) && (err.statusCode === 402 || err.statusCode === 429)) {
      // Budget / rate limit — the panel degrades to "numbers stand on their own".
      console.warn(`[insight] gateway ${err.statusCode} for tenant=${input.tenantId}`);
      return { ok: false, error: 'unavailable' };
    }
    console.error('[insight] generation failed', err);
    return { ok: false, error: 'unavailable' };
  }
}

// ----- data-driven confidence -----

/** Confidence reflects fact COMPLETENESS, not the model's self-report. */
export function reorderConfidence(f: ReorderFacts): number {
  let c = 0.9;
  if (f.daysOfSupply == null) c -= 0.25; // no forecast-backed cover estimate
  if (f.stockoutRiskPct == null) c -= 0.2;
  if (f.position == null || f.reorderPoint == null) c -= 0.15;
  return Math.max(0.3, Math.round(c * 100) / 100);
}

// ----- facts assembly -----

interface RawPoForFacts {
  id: string;
  location_id: string;
  suppliers: { name: string } | null;
  purchase_order_lines:
    | {
        product_id: string;
        ordered_qty: number | string;
        products: { sku: string | null } | null;
      }[]
    | null;
}

async function assembleReorderFacts(
  admin: SupabaseClient,
  tenantId: string,
  poId: string,
): Promise<ReorderFacts | null> {
  const { data: po } = await admin
    .from('purchase_orders')
    .select(
      'id, location_id, suppliers ( name ), purchase_order_lines ( product_id, ordered_qty, products ( sku ) )',
    )
    .eq('tenant_id', tenantId)
    .eq('id', poId)
    .maybeSingle<RawPoForFacts>();
  if (!po) return null;

  // The order's primary (first) line drives the narrative; the policy gives the
  // position / reorder point / cover the model explains.
  const line = (po.purchase_order_lines ?? [])[0];
  const sku = line?.products?.sku ?? 'this SKU';
  const orderedQty = line ? Number(line.ordered_qty) : 0;

  let position: number | null = null;
  let reorderPoint: number | null = null;
  let daysOfSupply: number | null = null;
  let stockoutRiskPct: number | null = null;

  if (line?.product_id) {
    const { data: policy } = await admin
      .from('inventory_policy')
      .select('reorder_point, days_of_supply, stockout_risk_score')
      .eq('tenant_id', tenantId)
      .eq('product_id', line.product_id)
      .eq('location_id', po.location_id) // the PO's warehouse, not just any
      .maybeSingle<{
        reorder_point: number | string | null;
        days_of_supply: number | string | null;
        stockout_risk_score: number | string | null;
      }>();
    if (policy) {
      reorderPoint = policy.reorder_point == null ? null : Number(policy.reorder_point);
      daysOfSupply = policy.days_of_supply == null ? null : round1(Number(policy.days_of_supply));
      stockoutRiskPct =
        policy.stockout_risk_score == null
          ? null
          : Math.round(Number(policy.stockout_risk_score) * 100);
    }
    const { data: level } = await admin
      .from('inventory_levels')
      .select('on_hand')
      .eq('tenant_id', tenantId)
      .eq('product_id', line.product_id)
      .eq('location_id', po.location_id)
      .maybeSingle<{ on_hand: number | string }>();
    if (level) position = round1(Number(level.on_hand));
  }

  return {
    sku,
    supplierName: po.suppliers?.name ?? 'the supplier',
    orderedQty,
    position,
    reorderPoint,
    daysOfSupply,
    stockoutRiskPct,
  };
}

// ----- cache -----

async function readCachedInsight(
  admin: SupabaseClient,
  tenantId: string,
  kind: InsightKind,
  entityId: string,
): Promise<InsightView | null> {
  const { data } = await admin
    .from('insights')
    .select('content, confidence, model, prompt_version')
    .eq('tenant_id', tenantId)
    .eq('entity_type', ENTITY_TYPE[kind])
    .eq('entity_id', entityId)
    .eq('prompt_version', PROMPT_VERSION)
    .maybeSingle<{
      content: { text?: string } | null;
      confidence: number | string | null;
      model: string;
      prompt_version: string;
    }>();
  if (!data?.content?.text) return null;
  return {
    content: data.content.text,
    confidence: data.confidence == null ? 0 : Number(data.confidence),
    model: data.model,
    promptVersion: data.prompt_version,
    cached: true,
  };
}

async function cacheInsight(
  admin: SupabaseClient,
  tenantId: string,
  kind: InsightKind,
  entityId: string,
  insight: InsightView,
): Promise<void> {
  // Idempotent on the unique index (tenant, entity_type, entity_id, prompt_version):
  // a concurrent first-view race resolves to one row, no duplicate model spend wasted.
  const { error } = await admin.from('insights').upsert(
    {
      tenant_id: tenantId,
      entity_type: ENTITY_TYPE[kind],
      entity_id: entityId,
      model: insight.model,
      prompt_version: insight.promptVersion,
      content: { text: insight.content },
      confidence: insight.confidence,
    },
    { onConflict: 'tenant_id,entity_type,entity_id,prompt_version' },
  );
  if (error) console.error(`[insight] cache write failed: ${error.message}`);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
