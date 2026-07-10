/**
 * QBO incremental-sync write core (Block 6, Wave 6.3-B).
 *
 * Runs the delta after a connection's first full sync: pull only the records QBO
 * changed since the watermark (`source_connections.last_synced_at`), and write
 * them through the conflict policy (`./conflict.ts`) instead of a blind upsert so
 * an operator's in-app edit is never clobbered.
 *
 * Scope: products, suppliers, and stock movements — the entities that change
 * often (new sales/receipts every day) and where the conflict policy matters.
 * Movements are an append-only ledger (idempotent insert, never a conflict).
 * Catalog/vendor records run the fingerprint-based last-write-wins policy and
 * touch ONLY QBO-owned fields (never operator-owned lead time / MOQ). PO delta
 * refresh is deferred (POs change rarely; ticketed).
 *
 * Like the initial sync this runs inside a workflow step via the service-role
 * admin client; authorization happened at the action/cron gate.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensurePrimaryLocation } from '@/lib/import/commit';
import { movementSourceRef, parseOccurredAt } from '@/lib/import/writers-shared';
import { type HistoricalMovementRow, recordStockMovements } from '@/lib/inventory/post-movement';
import type {
  CanonicalPayload,
  Cursor,
  EntityKind,
  PullResult,
  PullResultError,
} from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import type { QboSourceAdapter } from './adapter';
import { decideCatalogConflict, productFingerprint, supplierFingerprint } from './conflict';
import { markConnectionSynced } from './connection';
import { createQboAdapterForTenant } from './factory';

const PAGE_CAP = 1000;

export interface IncrementalSummary {
  inserted: number;
  updated: number;
  /** Auto-resolved conflicts logged (LWW winner picked). */
  conflicts: number;
  /** Conflicts queued for human review (pending). */
  needsReview: number;
  movements: number;
  errors: number;
}

const ZERO: IncrementalSummary = {
  inserted: 0,
  updated: 0,
  conflicts: 0,
  needsReview: 0,
  movements: 0,
  errors: 0,
};

export interface RunIncrementalParams {
  tenantId: string;
  connectionId: string;
  syncRunId: string;
}

export async function runQboIncrementalSync(
  params: RunIncrementalParams,
): Promise<IncrementalSummary> {
  const admin = createSupabaseAdmin();
  try {
    const { data: conn } = await admin
      .from('source_connections')
      .select('last_synced_at')
      .eq('id', params.connectionId)
      .single<{ last_synced_at: string | null }>();
    const floor = conn?.last_synced_at ?? undefined;

    const handle = await createQboAdapterForTenant(admin, params.tenantId, Date.now());
    if (!handle) throw new Error('QuickBooks is not connected for this tenant.');

    return await syncIncremental(admin, handle.adapter, params, floor, handle.connectionId);
  } catch (err) {
    await markFailed(admin, params.syncRunId, err);
    throw err;
  }
}

/** Separated so the integration test can drive a fixture-backed adapter directly. */
export async function syncIncremental(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  params: RunIncrementalParams,
  floor: string | undefined,
  connectionId: string,
): Promise<IncrementalSummary> {
  const { tenantId, connectionId: paramConn, syncRunId } = params;
  const conn = connectionId || paramConn;
  const summary = { ...ZERO };
  let watermark = floor;

  const advance = (items: CanonicalPayload[]) => {
    for (const it of items) {
      const t = it.externalUpdatedAt;
      if (t && (!watermark || t > watermark)) watermark = t;
    }
  };

  // Pending conflicts already queued for these entities, so we don't re-flag the
  // same needs_review every run (deduped by entity_id).
  const pending = await loadPendingConflictEntityIds(admin, conn);

  // ----- products -----
  const products = await drainSince(adapter, 'product', floor);
  advance(products.items);
  await applyProductDeltas(admin, tenantId, conn, products.items, pending, summary);
  summary.errors += products.errors.length;

  // ----- suppliers -----
  const suppliers = await drainSince(adapter, 'supplier', floor);
  advance(suppliers.items);
  await applySupplierDeltas(admin, tenantId, conn, suppliers.items, pending, summary);
  summary.errors += suppliers.errors.length;

  // ----- movements (append-only) -----
  const movements = await drainSince(adapter, 'stock_movement', floor);
  advance(movements.items);
  await applyMovementDeltas(admin, tenantId, syncRunId, movements.items, summary);
  summary.errors += movements.errors.length;

  await recordErrors(admin, tenantId, syncRunId, [
    ...products.errors,
    ...suppliers.errors,
    ...movements.errors,
  ]);
  await finalize(admin, syncRunId, conn, watermark ?? floor, summary);
  return summary;
}

// ---------- per-kind apply ----------

async function applyProductDeltas(
  admin: SupabaseClient,
  tenantId: string,
  connectionId: string,
  items: CanonicalPayload[],
  pending: Set<string>,
  summary: IncrementalSummary,
): Promise<void> {
  if (items.length === 0) return;
  const qboIds = items.map((i) => i.externalId);
  const { data: locals } = await admin
    .from('products')
    .select('id, name, description, unit_of_measure, status, external_ids, updated_at')
    .eq('tenant_id', tenantId)
    .in('external_ids->>qbo', qboIds)
    .returns<LocalProduct[]>();
  const byQbo = new Map((locals ?? []).map((r) => [r.external_ids?.qbo ?? '', r]));

  for (const item of items) {
    const a = item.attributes as CanonicalPayload<'product'>['attributes'];
    const local = byQbo.get(item.externalId);
    const incomingFp = productFingerprint(a);
    const decision = decideCatalogConflict({
      hasLocal: Boolean(local),
      storedFp: local?.external_ids?.qbo_fp ?? null,
      localFp: local
        ? productFingerprint({
            name: local.name,
            description: local.description,
            unitOfMeasure: local.unit_of_measure,
            status: local.status,
          })
        : '',
      incomingFp,
      localUpdatedAt: local?.updated_at ?? null,
      incomingExternalUpdatedAt: item.externalUpdatedAt ?? null,
    });

    if (decision.action === 'insert') {
      await admin.from('products').insert({
        tenant_id: tenantId,
        sku: a.sku,
        name: a.name,
        description: a.description ?? null,
        unit_of_measure: a.unitOfMeasure ?? null,
        status: a.status,
        external_ids: { qbo: item.externalId, qbo_fp: incomingFp },
        external_updated_at: item.externalUpdatedAt ?? null,
      });
      summary.inserted++;
      continue;
    }
    if (!local) continue;

    if (decision.action === 'apply') {
      await admin
        .from('products')
        .update({
          name: a.name,
          description: a.description ?? null,
          unit_of_measure: a.unitOfMeasure ?? null,
          status: a.status,
          external_ids: { ...local.external_ids, qbo_fp: incomingFp },
          external_updated_at: item.externalUpdatedAt ?? null,
        })
        .eq('id', local.id);
      summary.updated++;
    } else if (decision.conflict?.policyDecision === 'last_write_wins') {
      // accept_local: keep local fields, but acknowledge this remote version so it
      // doesn't re-flag (stamp the incoming fp + clock; local stays the winner).
      await admin
        .from('products')
        .update({
          external_ids: { ...local.external_ids, qbo_fp: incomingFp },
          external_updated_at: item.externalUpdatedAt ?? null,
        })
        .eq('id', local.id);
    }

    await logConflict(admin, tenantId, connectionId, pending, summary, {
      entityType: 'product',
      entityId: local.id,
      externalRef: item.externalId,
      decision,
      // Full QBO-owned field set (not just name/status) so the resolution
      // cockpit can apply accept_remote / merge without re-pulling from QBO.
      local: {
        name: local.name,
        description: local.description,
        unitOfMeasure: local.unit_of_measure,
        status: local.status,
      },
      remote: {
        name: a.name,
        description: a.description ?? null,
        unitOfMeasure: a.unitOfMeasure ?? null,
        status: a.status,
      },
    });
  }
}

async function applySupplierDeltas(
  admin: SupabaseClient,
  tenantId: string,
  connectionId: string,
  items: CanonicalPayload[],
  pending: Set<string>,
  summary: IncrementalSummary,
): Promise<void> {
  if (items.length === 0) return;
  const qboIds = items.map((i) => i.externalId);
  const { data: locals } = await admin
    .from('suppliers')
    .select('id, name, status, contact, external_ids, updated_at')
    .eq('tenant_id', tenantId)
    .in('external_ids->>qbo', qboIds)
    .returns<LocalSupplier[]>();
  const byQbo = new Map((locals ?? []).map((r) => [r.external_ids?.qbo ?? '', r]));

  // Supplier identity is case-insensitive name (the initial sync resolves that
  // way). For the insert branch, map operator-created suppliers that have no QBO
  // id yet by lower(name), so a new QBO vendor ATTACHES to the matching local row
  // instead of inserting a duplicate.
  const { data: unlinked } = await admin
    .from('suppliers')
    .select('id, name, external_ids')
    .eq('tenant_id', tenantId)
    .is('external_ids->>qbo', null)
    .returns<{ id: string; name: string }[]>();
  const byLowerName = new Map((unlinked ?? []).map((r) => [r.name.toLowerCase(), r.id]));

  for (const item of items) {
    const a = item.attributes as CanonicalPayload<'supplier'>['attributes'];
    const local = byQbo.get(item.externalId);
    // Merge QBO contact over the operator's (QBO wins per field, operator-only keys
    // survive); the fp is over what we WRITE so a clean re-sync isn't seen as dirty.
    const mergedContact = { ...(local?.contact ?? {}), ...a.contact };
    const incomingFp = supplierFingerprint({
      name: a.name,
      status: a.status,
      contact: mergedContact,
    });
    const decision = decideCatalogConflict({
      hasLocal: Boolean(local),
      storedFp: local?.external_ids?.qbo_fp ?? null,
      localFp: local
        ? supplierFingerprint({ name: local.name, status: local.status, contact: local.contact })
        : '',
      incomingFp,
      localUpdatedAt: local?.updated_at ?? null,
      incomingExternalUpdatedAt: item.externalUpdatedAt ?? null,
    });

    if (decision.action === 'insert') {
      const nameMatchId = byLowerName.get(a.name.toLowerCase());
      if (nameMatchId) {
        // An operator-created supplier of the same name — attach the QBO id to it
        // rather than create a duplicate, then treat it as updated.
        await admin
          .from('suppliers')
          .update({
            status: a.status,
            contact: mergedContact,
            qbo_vendor_id: item.externalId,
            external_ids: { qbo: item.externalId, qbo_fp: incomingFp },
            external_updated_at: item.externalUpdatedAt ?? null,
          })
          .eq('id', nameMatchId);
        summary.updated++;
      } else {
        await admin.from('suppliers').insert({
          tenant_id: tenantId,
          name: a.name,
          status: a.status,
          contact: mergedContact,
          qbo_vendor_id: item.externalId,
          external_ids: { qbo: item.externalId, qbo_fp: incomingFp },
          external_updated_at: item.externalUpdatedAt ?? null,
        });
        summary.inserted++;
      }
      continue;
    }
    if (!local) continue;

    if (decision.action === 'apply') {
      await admin
        .from('suppliers')
        .update({
          name: a.name,
          status: a.status,
          contact: mergedContact,
          external_ids: { ...local.external_ids, qbo_fp: incomingFp },
          external_updated_at: item.externalUpdatedAt ?? null,
        })
        .eq('id', local.id);
      summary.updated++;
    } else if (decision.conflict?.policyDecision === 'last_write_wins') {
      await admin
        .from('suppliers')
        .update({
          external_ids: { ...local.external_ids, qbo_fp: incomingFp },
          external_updated_at: item.externalUpdatedAt ?? null,
        })
        .eq('id', local.id);
    }

    await logConflict(admin, tenantId, connectionId, pending, summary, {
      entityType: 'supplier',
      entityId: local.id,
      externalRef: item.externalId,
      decision,
      // Full QBO-owned field set (incl. contact) so the resolution cockpit can
      // apply accept_remote / merge without re-pulling from QBO.
      local: { name: local.name, status: local.status, contact: local.contact },
      remote: { name: a.name, status: a.status, contact: mergedContact },
    });
  }
}

async function applyMovementDeltas(
  admin: SupabaseClient,
  tenantId: string,
  syncRunId: string,
  items: CanonicalPayload[],
  summary: IncrementalSummary,
): Promise<void> {
  if (items.length === 0) return;
  const qboToProductId = await loadQboProductIds(admin, tenantId);

  const staged: Record<string, unknown>[] = [];
  const rowErrors: PullResultError[] = [];
  for (const item of items) {
    const a = item.attributes as CanonicalPayload<'stock_movement'>['attributes'];
    const productId = qboToProductId.get(a.productExternalId);
    if (!productId) continue; // non-inventory line — expected skip, like the initial path
    const occurredIso = parseOccurredAt(a.occurredAt);
    if (occurredIso === null) {
      // A movement we resolved but couldn't read is a genuine problem — record it
      // so a dropped row is never silent (matches the initial-sync movement path).
      rowErrors.push({
        externalId: a.productExternalId,
        code: 'invalid_date',
        message: `A QuickBooks movement for item ${a.productExternalId} had an unreadable date "${a.occurredAt}".`,
      });
      continue;
    }
    staged.push({
      tenant_id: tenantId,
      product_id: productId,
      type: a.type,
      quantity: a.quantity,
      source: 'qbo',
      source_ref:
        a.sourceRef ?? movementSourceRef(a.productExternalId, a.type, a.quantity, occurredIso),
      occurred_at: occurredIso,
    });
  }
  await recordErrors(admin, tenantId, syncRunId, rowErrors);
  summary.errors += rowErrors.length;
  if (staged.length === 0) return;

  const locationId = await ensurePrimaryLocation(admin, tenantId);
  const rows = staged.map((r) => ({ ...r, location_id: locationId }));
  // W2-2.5: deltas enter through the kernel's ingestion door — append-only,
  // balance-neutral, replay-safe on the dedup key. The returned count is ONLY
  // the newly inserted rows, so a re-run reports 0 new movements, not a
  // phantom batch.
  const written = await recordStockMovements(
    admin,
    tenantId,
    rows as unknown as HistoricalMovementRow[],
  );
  if (!written.ok) throw new Error(`movement delta ingest failed: ${written.error}`);
  summary.movements += written.inserted;
}

// ---------- conflict logging ----------

interface LogConflictInput {
  entityType: string;
  entityId: string;
  externalRef: string;
  decision: ReturnType<typeof decideCatalogConflict>;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
}

async function logConflict(
  admin: SupabaseClient,
  tenantId: string,
  connectionId: string,
  pending: Set<string>,
  summary: IncrementalSummary,
  input: LogConflictInput,
): Promise<void> {
  const c = input.decision.conflict;
  if (!c) return;

  if (c.policyDecision === 'needs_review') {
    if (pending.has(input.entityId)) {
      // Already queued — don't spawn a duplicate, but DON'T discard the newer
      // remote state either: refresh the open conflict so the operator resolves
      // against what QBO looks like now, not a stale snapshot.
      await admin
        .from('sync_conflicts')
        .update({ remote_state: input.remote, local_state: input.local })
        .eq('tenant_id', tenantId)
        .eq('entity_id', input.entityId)
        .eq('applied_resolution', 'pending');
      return;
    }
    pending.add(input.entityId);
    summary.needsReview++;
  } else {
    summary.conflicts++;
  }

  const resolved = c.appliedResolution !== 'pending';
  await admin.from('sync_conflicts').insert({
    tenant_id: tenantId,
    source_connection_id: connectionId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    external_ref: input.externalRef,
    local_state: input.local,
    remote_state: input.remote,
    policy_decision: c.policyDecision,
    applied_resolution: c.appliedResolution,
    resolved_at: resolved ? new Date().toISOString() : null,
  });
}

async function loadPendingConflictEntityIds(
  admin: SupabaseClient,
  connectionId: string,
): Promise<Set<string>> {
  const { data } = await admin
    .from('sync_conflicts')
    .select('entity_id')
    .eq('source_connection_id', connectionId)
    .eq('applied_resolution', 'pending')
    .returns<{ entity_id: string | null }[]>();
  return new Set((data ?? []).map((r) => r.entity_id).filter((x): x is string => Boolean(x)));
}

// ---------- shared mechanics ----------

interface LocalProduct {
  id: string;
  name: string;
  description: string | null;
  unit_of_measure: string | null;
  status: string;
  external_ids: { qbo?: string; qbo_fp?: string } | null;
  updated_at: string;
}
interface LocalSupplier {
  id: string;
  name: string;
  status: string;
  contact: Record<string, unknown> | null;
  external_ids: { qbo?: string; qbo_fp?: string } | null;
  updated_at: string;
}

/** Drain one kind pulling only records changed after `floor` (delta). */
async function drainSince(
  adapter: QboSourceAdapter,
  kind: EntityKind,
  floor: string | undefined,
): Promise<{ items: CanonicalPayload[]; errors: PullResultError[] }> {
  const seed: Cursor | null = floor
    ? {
        raw:
          kind === 'stock_movement'
            ? { entity: 'Bill', startPosition: 1, floor }
            : { startPosition: 1, floor },
        highWatermark: floor,
      }
    : null;

  const items: CanonicalPayload[] = [];
  const errors: PullResultError[] = [];
  let cursor = seed;
  for (let page = 0; page < PAGE_CAP; page++) {
    const res: PullResult = await adapter.pull(kind, cursor, `inc:${kind}`);
    items.push(...res.items);
    errors.push(...res.errors);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return { items, errors };
}

async function loadQboProductIds(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('products')
    .select('id, external_ids')
    .eq('tenant_id', tenantId)
    .returns<{ id: string; external_ids: { qbo?: string } | null }[]>();
  const map = new Map<string, string>();
  for (const p of data ?? []) {
    const qboId = p.external_ids?.qbo;
    if (qboId) map.set(qboId, p.id);
  }
  return map;
}

async function recordErrors(
  admin: SupabaseClient,
  tenantId: string,
  syncRunId: string,
  errors: PullResultError[],
): Promise<void> {
  if (errors.length === 0) return;
  await admin.from('sync_failures').insert(
    errors.map((e) => ({
      tenant_id: tenantId,
      sync_run_id: syncRunId,
      entity_type: 'qbo_incremental',
      external_ref: e.externalId ?? null,
      payload: null,
      error_code: e.code,
      error_message: e.message,
    })),
  );
}

async function finalize(
  admin: SupabaseClient,
  syncRunId: string,
  connectionId: string,
  watermark: string | undefined,
  summary: IncrementalSummary,
): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      entities_processed: {
        inserted: summary.inserted,
        updated: summary.updated,
        movements: summary.movements,
        conflicts: summary.conflicts,
        needs_review: summary.needsReview,
      },
      cursor: { kind: 'incremental', done: true, summary },
      error_log: [],
    })
    .eq('id', syncRunId);
  // Advance the watermark so the next delta only pulls newer changes.
  await markConnectionSynced(admin, connectionId, watermark ?? new Date().toISOString());
}

async function markFailed(admin: SupabaseClient, syncRunId: string, err: unknown): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_log: [err instanceof Error ? err.message : String(err)],
    })
    .eq('id', syncRunId);
}
