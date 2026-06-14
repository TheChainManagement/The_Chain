/**
 * Alert generation core (in-app alerts engine) — server-only. Reads the
 * operator's risk surfaces for a tenant, builds the fireable alerts (pure
 * `conditions.ts`), upserts each through the dedupe/severity contract
 * (`upsert_alert`), then auto-closes any open alert whose condition no longer
 * fires (`close_stale_alerts`). Idempotent: re-running on unchanged data holds
 * every alert (no new rows, no duplicate notifications).
 *
 * Writes via the service-role admin client; the workflow step / action gate
 * authorizes. inventory_policy + reorder_recommendations are system-write.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildFireableAlerts,
  type ConditionInputs,
  ENGINE_KINDS,
  type FireableAlert,
  type LatePoRow,
  type OpenRecRow,
  type PolicyRow,
  type SyncFailureRow,
} from './conditions';

const DAY_MS = 24 * 60 * 60 * 1000;
const LATE_PO_STATUSES = ['sent', 'exported', 'partial_received'];

export interface GenerateAlertsResult {
  created: number;
  escalated: number;
  held: number;
  closed: number;
  fired: number;
}

export async function runAlertGeneration(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<GenerateAlertsResult> {
  const inputs = await loadInputs(admin, tenantId, nowMs);
  const fireable = buildFireableAlerts(inputs);

  let created = 0;
  let escalated = 0;
  let held = 0;
  for (const a of fireable) {
    const action = await upsertAlert(admin, tenantId, a);
    if (action === 'created') created++;
    else if (action === 'escalated') escalated++;
    else held++;
  }

  // Auto-close the conditions that cleared since the last run.
  const activeKeys = fireable.map((a) => a.dedupeKey);
  const { data: closedData, error: closeErr } = await admin.rpc('close_stale_alerts', {
    p_tenant: tenantId,
    p_kinds: ENGINE_KINDS,
    p_active_keys: activeKeys,
  });
  if (closeErr) throw new Error(`close_stale_alerts failed: ${closeErr.message}`);

  return { created, escalated, held, closed: Number(closedData ?? 0), fired: fireable.length };
}

async function upsertAlert(
  admin: SupabaseClient,
  tenantId: string,
  a: FireableAlert,
): Promise<string> {
  const { data, error } = await admin.rpc('upsert_alert', {
    p_tenant: tenantId,
    p_kind: a.kind,
    p_entity_type: a.entityType,
    p_entity_id: a.entityId,
    p_dedupe_key: a.dedupeKey,
    p_severity: a.severity,
    p_payload: a.payload,
  });
  if (error) throw new Error(`upsert_alert(${a.dedupeKey}) failed: ${error.message}`);
  const row = (data as { out_action: string }[] | null)?.[0];
  return row?.out_action ?? 'held';
}

// ----- input read models -----

async function loadInputs(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<ConditionInputs> {
  const [policies, openRecs, latePos, syncFailures, syncConflictCount] = await Promise.all([
    loadPolicies(admin, tenantId),
    loadOpenRecs(admin, tenantId),
    loadLatePos(admin, tenantId, nowMs),
    loadSyncFailures(admin, tenantId),
    loadSyncConflictCount(admin, tenantId),
  ]);
  return { policies, openRecs, latePos, syncFailures, syncConflictCount };
}

interface RawPolicy {
  product_id: string;
  days_of_supply: number | string | null;
  stockout_risk_score: number | string | null;
  reorder_point: number | string | null;
  products: { sku: string | null; name: string | null } | null;
}

async function loadPolicies(admin: SupabaseClient, tenantId: string): Promise<PolicyRow[]> {
  const { data, error } = await admin
    .from('inventory_policy')
    .select(
      'product_id, days_of_supply, stockout_risk_score, reorder_point, products ( sku, name )',
    )
    .eq('tenant_id', tenantId)
    .returns<RawPolicy[]>();
  if (error) throw new Error(`load policies failed: ${error.message}`);

  // Aggregate to one row per product (worst case across locations): lowest DOS,
  // highest stockout risk. Wave 1 is single-location, but this keeps the
  // per-product dedupe key honest if a product spans locations.
  const byProduct = new Map<string, PolicyRow>();
  for (const r of data ?? []) {
    const dos = r.days_of_supply == null ? null : Number(r.days_of_supply);
    const score = r.stockout_risk_score == null ? null : Number(r.stockout_risk_score);
    const existing = byProduct.get(r.product_id);
    if (!existing) {
      byProduct.set(r.product_id, {
        productId: r.product_id,
        sku: r.products?.sku ?? '—',
        name: r.products?.name ?? '—',
        daysOfSupply: dos,
        stockoutRiskScore: score,
        reorderPoint: r.reorder_point == null ? null : Number(r.reorder_point),
      });
      continue;
    }
    existing.daysOfSupply = worstDos(existing.daysOfSupply, dos);
    existing.stockoutRiskScore = worstScore(existing.stockoutRiskScore, score);
  }
  return [...byProduct.values()];
}

const worstDos = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.min(a, b);
const worstScore = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.max(a, b);

interface RawRec {
  product_id: string;
  recommended_qty: number | string;
  reason: {
    position?: number;
    reorderPoint?: number;
    safetyStock?: number;
    daysOfSupply?: number | null;
  } | null;
  products: { sku: string | null; name: string | null } | null;
}

async function loadOpenRecs(admin: SupabaseClient, tenantId: string): Promise<OpenRecRow[]> {
  const { data, error } = await admin
    .from('reorder_recommendations')
    .select('product_id, recommended_qty, reason, products ( sku, name )')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .returns<RawRec[]>();
  if (error) throw new Error(`load open recs failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    productId: r.product_id,
    sku: r.products?.sku ?? '—',
    name: r.products?.name ?? '—',
    recommendedQty: Number(r.recommended_qty),
    position: Number(r.reason?.position ?? 0),
    reorderPoint: Number(r.reason?.reorderPoint ?? 0),
    safetyStock: Number(r.reason?.safetyStock ?? 0),
    daysOfSupply: r.reason?.daysOfSupply == null ? null : Number(r.reason.daysOfSupply),
  }));
}

interface RawLatePo {
  id: string;
  external_reference: string | null;
  external_po_id: string | null;
  expected_delivery_at: string | null;
  suppliers: { name: string } | null;
}

async function loadLatePos(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<LatePoRow[]> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await admin
    .from('purchase_orders')
    .select('id, external_reference, external_po_id, expected_delivery_at, suppliers ( name )')
    .eq('tenant_id', tenantId)
    .in('status', LATE_PO_STATUSES)
    .not('expected_delivery_at', 'is', null)
    .lt('expected_delivery_at', nowIso)
    .returns<RawLatePo[]>();
  if (error) throw new Error(`load late POs failed: ${error.message}`);
  return (data ?? []).map((po) => {
    const due = po.expected_delivery_at ? Date.parse(po.expected_delivery_at) : nowMs;
    const daysLate = Math.max(1, Math.floor((nowMs - due) / DAY_MS));
    return {
      poId: po.id,
      reference: poReference(po.external_reference, po.external_po_id, po.id),
      supplierName: po.suppliers?.name ?? 'the supplier',
      daysLate,
    };
  });
}

async function loadSyncFailures(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SyncFailureRow[]> {
  const { data, error } = await admin
    .from('sync_failures')
    .select('id, entity_type, error_message')
    .eq('tenant_id', tenantId)
    .eq('resolution_status', 'pending')
    .returns<{ id: string; entity_type: string | null; error_message: string | null }[]>();
  if (error) throw new Error(`load sync failures failed: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    entityType: f.entity_type,
    message: f.error_message,
  }));
}

async function loadSyncConflictCount(admin: SupabaseClient, tenantId: string): Promise<number> {
  // "Needs review" = the conflict the sync couldn't auto-resolve (matches the
  // /flow/sync-conflicts cockpit's listPendingConflicts filter).
  const { count, error } = await admin
    .from('sync_conflicts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('applied_resolution', 'pending');
  if (error) throw new Error(`load sync conflicts failed: ${error.message}`);
  return count ?? 0;
}

/** Mirror of the PO reference fallback (kept local — pure, no cross-import). */
function poReference(
  externalReference: string | null,
  externalPoId: string | null,
  internalId: string,
): string {
  if (externalReference?.trim()) return externalReference.trim();
  if (externalPoId?.trim()) return `QBO #${externalPoId.trim()}`;
  return `PO ${internalId.slice(0, 8)}`;
}
