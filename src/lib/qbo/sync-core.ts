/**
 * QBO initial-sync write core (Block 6, Wave 6.2b).
 *
 * The QBO counterpart to the CSV `durable-commit.ts`. Runs INSIDE a Workflow
 * DevKit step (detached from the user's login session), so every write goes
 * through the service-role admin client with an explicit tenant_id; authorization
 * already happened at the Server Action gate before the workflow started (the
 * same trust model as the CSV durable path, SYSTEM_DESIGN §Workflows).
 *
 * It pulls the operator's QuickBooks data through the same `QboSourceAdapter` the
 * read-only connect preview uses, then writes the canonical payloads into the
 * catalog in dependency order:
 *   1. products  (items)         → products              upsert (tenant_id, sku)
 *   2. suppliers (vendors)       → suppliers              upsert (tenant_id, id by lower(name))
 *   3. movements (bills + sales) → stock_movements        upsert (tenant_id, source, source_ref, occurred_at)
 *   4. purchase orders           → purchase_orders/_lines upsert (tenant_id, external_po_id)
 *
 * Purchase orders write last because they reference both products and suppliers
 * (Wave 6.3-A). The header upserts on the QBO PO id (`external_po_id`); lines
 * upsert on (po_id, line_no) with a tail-prune so a shrunk PO converges. A PO
 * whose lines are all non-inventory is skipped, like a non-inventory movement.
 *
 * Crash-safety:
 *   - **Idempotent upserts** per kind (same conflict keys as the CSV path).
 *     Movements key on QBO's real entity ref (`qbo:bill:..`/`qbo:sales:..`),
 *     which is stronger than the CSV content hash. A retried step converges to
 *     the same final state.
 *   - **Phase cursor** persisted to `sync_runs.cursor` after each kind. On a
 *     resumed run a kind already recorded in `cursor.results` is skipped (no
 *     re-pull, no re-write). "Cursor persisted between steps" per FEATURES §QBO.
 *
 * QBO-vs-CSV difference that matters: QBO movements reference a product by its
 * QBO Item Id, not its SKU, so movements resolve product_id through
 * `products.external_ids->>'qbo'`, not by SKU.
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
import { productFingerprint, supplierFingerprint } from './conflict';
import { markConnectionSynced } from './connection';
import { createQboAdapterForTenant } from './factory';

/** Bounded so a misbehaving cursor can never paginate forever. */
const PAGE_CAP = 1000;
/** Rows per DB round-trip. Bounds memory + gives the upsert a sane batch size. */
const BATCH = 500;
const FAILURE_PREVIEW = 20;

export type SyncPhase = 'product' | 'supplier' | 'stock_movement' | 'purchase_order';
// POs reference products + suppliers, so they write last (after both exist). It
// also keeps the connect-screen reveal (CATALOG → SUPPLIERS → SALES) intact: the
// three visible links finish in order, then POs land as a trailing technical phase.
const PHASE_ORDER: SyncPhase[] = ['product', 'supplier', 'stock_movement', 'purchase_order'];

/** The chain-summary counts the connect screen renders, and the run's result. */
export interface QboSyncCounts {
  catalog: number;
  suppliers: number;
  ordered: number;
  inTransit: number;
  receipts: number;
  sales: number;
  errors: number;
  /** Non-inventory movement lines (service sales, fees) the inventory tool skips. */
  skipped: number;
}

interface PhaseResult {
  product?: { written: number; errors: number };
  supplier?: { written: number; errors: number };
  stock_movement?: { receipts: number; sales: number; errors: number; skipped: number };
  purchase_order?: { ordered: number; inTransit: number; lines: number; errors: number };
}

/**
 * Cursor persisted to `sync_runs.cursor`. `results` records completed phases for
 * resume; `phase` + processed/total drive the live progress UI; the flattened
 * counts + `done` let the poller hand the connect screen its summary without
 * reading the workflow's return value (mirrors the CSV durable finalize).
 */
export interface QboSyncCursor extends QboSyncCounts {
  phase: SyncPhase | 'done';
  processed: number;
  total: number;
  results: PhaseResult;
  done: boolean;
}

export interface RunQboSyncParams {
  tenantId: string;
  syncRunId: string;
}

export async function runQboInitialSync(params: RunQboSyncParams): Promise<QboSyncCounts> {
  const { tenantId, syncRunId } = params;
  const admin = createSupabaseAdmin();
  try {
    const handle = await createQboAdapterForTenant(admin, tenantId, Date.now());
    if (!handle) {
      throw new Error('QuickBooks is not connected for this tenant.');
    }
    return await syncCatalogFromAdapter(
      admin,
      handle.adapter,
      tenantId,
      syncRunId,
      handle.connectionId,
    );
  } catch (err) {
    // Deterministic failures (auth, schema, permission) dominate here; mark the
    // run failed so the poller surfaces it instead of spinning to its cap. A
    // later successful retry overwrites to completed via finalize().
    await markFailed(admin, syncRunId, err);
    throw err;
  }
}

/**
 * The write core, given an already-built adapter. Separated from token/connection
 * lifecycle so the integration test can drive it with a fixture-backed adapter
 * (and so a future incremental sync can reuse the same phase machinery).
 */
export async function syncCatalogFromAdapter(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
  connectionId: string,
): Promise<QboSyncCounts> {
  const counts = await runPhases(admin, adapter, tenantId, syncRunId);
  await finalize(admin, syncRunId, connectionId, counts);
  return counts;
}

async function runPhases(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
): Promise<QboSyncCounts> {
  const results = await readResults(admin, syncRunId);

  for (const phase of PHASE_ORDER) {
    if (results[phase]) continue; // already done on a prior attempt — skip the re-pull
    await writeProgress(admin, syncRunId, phase, results, 0, 0);

    if (phase === 'product') {
      results.product = await syncProducts(admin, adapter, tenantId, syncRunId, results);
    } else if (phase === 'supplier') {
      results.supplier = await syncSuppliers(admin, adapter, tenantId, syncRunId, results);
    } else if (phase === 'stock_movement') {
      results.stock_movement = await syncMovements(admin, adapter, tenantId, syncRunId, results);
    } else {
      results.purchase_order = await syncPurchaseOrders(
        admin,
        adapter,
        tenantId,
        syncRunId,
        results,
      );
    }
  }

  return flatten(results);
}

// ---------- per-kind sync (drain → write → record failures) ----------

async function syncProducts(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
  results: PhaseResult,
): Promise<{ written: number; errors: number }> {
  const pull = await drainKind(adapter, 'product');
  const rows = pull.items.map((item) => {
    const a = item.attributes as CanonicalPayload<'product'>['attributes'];
    return {
      tenant_id: tenantId,
      sku: a.sku,
      name: a.name,
      description: a.description ?? null,
      unit_of_measure: a.unitOfMeasure ?? null,
      status: a.status,
      // qbo_fp is the QBO-owned-field baseline the incremental conflict policy
      // diffs against; external_updated_at is the remote change clock (Wave 6.3-B).
      external_ids: { qbo: item.externalId, qbo_fp: productFingerprint(a) },
      external_updated_at: item.externalUpdatedAt ?? null,
    };
  });

  const written = await upsertBatched(admin, syncRunId, 'product', results, rows, (batch) =>
    admin.from('products').upsert(batch, { onConflict: 'tenant_id,sku' }).select('id'),
  );
  await recordFailures(admin, tenantId, syncRunId, 'product', pull.errors);
  return { written, errors: pull.errors.length };
}

async function syncSuppliers(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
  results: PhaseResult,
): Promise<{ written: number; errors: number }> {
  const pull = await drainKind(adapter, 'supplier');

  // No JWT inside a workflow, so the case-insensitive RPC can't run; resolve
  // lower(name)->id ourselves and upsert on the (tenant_id, id) primary key.
  // Carry the existing contact too, so enrichment MERGES rather than clobbers.
  const { data: existing } = await admin
    .from('suppliers')
    .select('id, name, contact')
    .eq('tenant_id', tenantId)
    .returns<{ id: string; name: string; contact: Record<string, unknown> | null }[]>();
  const byLowerName = new Map(
    (existing ?? []).map((s) => [s.name.toLowerCase(), { id: s.id, contact: s.contact ?? {} }]),
  );

  const rows = pull.items.map((item) => {
    const a = item.attributes as CanonicalPayload<'supplier'>['attributes'];
    const prior = byLowerName.get(a.name.toLowerCase());
    // Merge QBO contact OVER any existing one (QBO wins per field, but a value the
    // operator added that QBO doesn't carry survives). `merged` always spreads the
    // prior contact first, so it can only be empty when both sides are — writing it
    // unconditionally satisfies the NOT NULL column without ever erasing data. (A
    // heterogeneous batch upsert would null out any row that omitted the key.)
    const contact = { ...(prior?.contact ?? {}), ...a.contact };
    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      name: a.name,
      default_lead_time_days: a.defaultLeadTimeDays ?? null,
      min_order_value: a.minOrderValue ?? null,
      status: a.status,
      contact,
      // Enrichment: QBO email/phone/web + the queryable vendor id (Wave 6.3-A).
      qbo_vendor_id: item.externalId,
      // qbo_fp = the QBO-owned-field baseline for the incremental conflict policy;
      // external_updated_at = the remote change clock (Wave 6.3-B). The fp covers the
      // contact we actually WRITE (merged), so a clean re-sync is not seen as dirty.
      external_ids: {
        qbo: item.externalId,
        qbo_fp: supplierFingerprint({ name: a.name, status: a.status, contact }),
      },
      external_updated_at: item.externalUpdatedAt ?? null,
    };
    if (prior) row.id = prior.id;
    return row;
  });

  const written = await upsertBatched(admin, syncRunId, 'supplier', results, rows, (batch) =>
    admin.from('suppliers').upsert(batch, { onConflict: 'tenant_id,id' }).select('id'),
  );
  await recordFailures(admin, tenantId, syncRunId, 'supplier', pull.errors);
  return { written, errors: pull.errors.length };
}

async function syncMovements(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
  results: PhaseResult,
): Promise<{ receipts: number; sales: number; errors: number; skipped: number }> {
  const pull = await drainKind(adapter, 'stock_movement');

  // QBO movements reference products by QBO Item Id, so resolve product_id via
  // external_ids->>'qbo' (NOT by SKU like the CSV path). Products were written in
  // the product phase; on a resumed run that phase is skipped, so read from the DB.
  const qboToProductId = await loadQboProductIds(admin, tenantId);

  const rowErrors: PullResultError[] = [];
  const staged: MovementRow[] = [];
  // A movement for an item we didn't sync as a product is a NON-INVENTORY line
  // (a service sale, a fee). The Chain tracks inventory only, so this is an
  // expected skip — NOT an error. Counted separately so the UI never alarms the
  // operator over a services company's service sales.
  let skipped = 0;

  for (const item of pull.items) {
    const a = item.attributes as CanonicalPayload<'stock_movement'>['attributes'];
    const productId = qboToProductId.get(a.productExternalId);
    if (!productId) {
      skipped++;
      continue;
    }
    const occurredIso = parseOccurredAt(a.occurredAt);
    if (occurredIso === null) {
      rowErrors.push({
        externalId: a.productExternalId,
        code: 'invalid_date',
        message: `A movement for QuickBooks item ${a.productExternalId} had an unreadable date "${a.occurredAt}".`,
      });
      continue;
    }
    staged.push({
      tenant_id: tenantId,
      product_id: productId,
      type: a.type,
      quantity: a.quantity,
      source: 'qbo',
      // QBO supplies a real entity ref; fall back to a content hash only if absent.
      source_ref:
        a.sourceRef ?? movementSourceRef(a.productExternalId, a.type, a.quantity, occurredIso),
      occurred_at: occurredIso,
    });
  }

  if (staged.length > 0) {
    const locationId = await ensurePrimaryLocation(admin, tenantId);
    const rows = staged.map((r) => ({ ...r, location_id: locationId }));
    // W2-2.5: batches enter through the kernel's ingestion door — append-only,
    // balance-neutral, idempotent on the QBO entity ref (a re-sync collides and
    // is skipped, same dedup key the direct upsert used).
    for (let offset = 0; offset < rows.length; offset += BATCH) {
      const batch = rows.slice(offset, offset + BATCH);
      const written = await recordStockMovements(
        admin,
        tenantId,
        batch as unknown as HistoricalMovementRow[],
      );
      if (!written.ok) throw new Error(`stock_movement ingest failed: ${written.error}`);
      await writeProgress(
        admin,
        syncRunId,
        'stock_movement',
        results,
        offset + batch.length,
        rows.length,
      );
    }
  }

  // Only genuine problems are errors: schema failures from the adapter + rows we
  // resolved but couldn't read (bad date). Non-inventory skips are not recorded.
  const allErrors = [...pull.errors, ...rowErrors];
  await recordFailures(admin, tenantId, syncRunId, 'stock_movement', allErrors);

  // Headline counts = movements from QBO now in the catalog (every staged row is
  // present after the upsert, whether inserted now or on a prior run), so the
  // numbers are stable across a fresh sync and a re-sync rather than dropping to
  // zero once the data is already imported.
  return {
    receipts: staged.filter((r) => r.type === 'receipt').length,
    sales: staged.filter((r) => r.type === 'sale').length,
    errors: allErrors.length,
    skipped,
  };
}

/** Open = still in flight: not received, closed, or canceled. */
function isOpenPoStatus(status: string): boolean {
  return status !== 'received' && status !== 'closed' && status !== 'canceled';
}

async function syncPurchaseOrders(
  admin: SupabaseClient,
  adapter: QboSourceAdapter,
  tenantId: string,
  syncRunId: string,
  results: PhaseResult,
): Promise<{ ordered: number; inTransit: number; lines: number; errors: number }> {
  const pull = await drainKind(adapter, 'purchase_order');

  // POs reference a vendor + items, both already written this run. Resolve each
  // by its QBO external id through external_ids->>'qbo' (the same indirection the
  // movement phase uses for products).
  const qboToSupplierId = await loadQboSupplierIds(admin, tenantId);
  const qboToProductId = await loadQboProductIds(admin, tenantId);

  const rowErrors: PullResultError[] = [];
  // Lines we drop from an IMPORTED PO because their product didn't resolve. We
  // record these to sync_failures so a partial PO is auditable (never a silent
  // truncation) — but they do NOT count toward the headline error total, since a
  // mixed inventory/service PO dropping its service lines is expected, not a fault.
  const droppedLines: PullResultError[] = [];
  const staged: StagedPo[] = [];

  for (const item of pull.items) {
    const a = item.attributes as CanonicalPayload<'purchase_order'>['attributes'];
    const supplierId = qboToSupplierId.get(a.supplierExternalId);
    if (!supplierId) {
      rowErrors.push({
        externalId: item.externalId,
        code: 'unknown_supplier',
        message: `Purchase order ${a.reference ?? item.externalId} references QuickBooks vendor ${a.supplierExternalId}, which was not imported as a supplier.`,
      });
      continue;
    }

    const lines: PoLineRow[] = [];
    const dropped: PullResultError[] = [];
    for (const l of a.lines) {
      const productId = qboToProductId.get(l.productExternalId);
      if (!productId) {
        dropped.push({
          externalId: `${item.externalId}:${l.lineNo}`,
          code: 'unmapped_po_line',
          message: `Purchase order ${a.reference ?? item.externalId} line ${l.lineNo} references QuickBooks item ${l.productExternalId}, which is not an imported inventory product; the line was skipped.`,
        });
        continue;
      }
      lines.push({
        line_no: l.lineNo,
        product_id: productId,
        ordered_qty: l.orderedQty,
        unit_cost: l.unitCost ?? null,
      });
    }

    // A PO whose lines are all non-inventory (service items, fees) is skipped the
    // same way non-inventory movements are — it is not an inventory PO, not an error,
    // and we don't surface its lines (a fully-service PO isn't ours to track).
    if (lines.length === 0) continue;

    // The PO IS being imported, so any line we couldn't map is now a visible gap
    // between the PO's total and its lines — record it so it's never silent.
    droppedLines.push(...dropped);
    staged.push({
      externalId: item.externalId,
      status: a.status,
      attributes: a,
      supplierId,
      lines,
    });
  }

  let ordered = 0;
  let inTransit = 0;
  let lineCount = 0;

  if (staged.length > 0) {
    const locationId = await ensurePrimaryLocation(admin, tenantId);
    const nowIso = new Date().toISOString();

    const headerRows = staged.map((s) => ({
      tenant_id: tenantId,
      supplier_id: s.supplierId,
      location_id: locationId,
      status: s.status,
      recommended_by: 'external',
      external_po_id: s.externalId,
      external_reference: s.attributes.reference ?? null,
      total: s.attributes.total ?? null,
      expected_delivery_at: s.attributes.expectedDeliveryAt ?? null,
      actual_delivery_at: s.attributes.actualDeliveryAt ?? null,
      sync_status: 'in_sync',
      last_synced_at: nowIso,
    }));

    const { data: upserted, error: hErr } = await admin
      .from('purchase_orders')
      .upsert(headerRows, { onConflict: 'tenant_id,external_po_id' })
      .select('id, external_po_id')
      .returns<{ id: string; external_po_id: string }[]>();
    if (hErr) throw new Error(`purchase_order upsert failed: ${hErr.message}`);

    const idByExternal = new Map((upserted ?? []).map((r) => [r.external_po_id, r.id]));

    // Lines mirror QBO exactly: upsert on (po_id, line_no), then prune any tail
    // rows from an earlier, longer version of the PO so a re-sync converges.
    const lineRows: Record<string, unknown>[] = [];
    for (const s of staged) {
      const poId = idByExternal.get(s.externalId);
      if (!poId) continue;
      for (const l of s.lines) lineRows.push({ tenant_id: tenantId, po_id: poId, ...l });
    }
    if (lineRows.length > 0) {
      const { error: lErr } = await admin
        .from('purchase_order_lines')
        .upsert(lineRows, { onConflict: 'po_id,line_no' });
      if (lErr) throw new Error(`purchase_order_lines upsert failed: ${lErr.message}`);
    }
    for (const s of staged) {
      const poId = idByExternal.get(s.externalId);
      if (!poId) continue;
      const maxLineNo = s.lines.reduce((m, l) => Math.max(m, l.line_no), 0);
      await admin.from('purchase_order_lines').delete().eq('po_id', poId).gt('line_no', maxLineNo);
    }

    ordered = staged.length;
    inTransit = staged.filter((s) => isOpenPoStatus(s.status)).length;
    lineCount = lineRows.length;
    await writeProgress(admin, syncRunId, 'purchase_order', results, staged.length, staged.length);
  }

  // Dropped lines ride into sync_failures for the audit trail but stay out of the
  // headline error count (expected for mixed inventory/service POs).
  await recordFailures(admin, tenantId, syncRunId, 'purchase_order', [
    ...pull.errors,
    ...rowErrors,
    ...droppedLines,
  ]);
  return { ordered, inTransit, lines: lineCount, errors: pull.errors.length + rowErrors.length };
}

async function loadQboSupplierIds(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('suppliers')
    .select('id, external_ids')
    .eq('tenant_id', tenantId)
    .returns<{ id: string; external_ids: { qbo?: string } | null }[]>();
  const map = new Map<string, string>();
  for (const s of data ?? []) {
    const qboId = s.external_ids?.qbo;
    if (qboId) map.set(qboId, s.id);
  }
  return map;
}

// ---------- shared mechanics ----------

interface PoLineRow {
  line_no: number;
  product_id: string;
  ordered_qty: number;
  unit_cost: number | null;
}

interface StagedPo {
  externalId: string;
  status: string;
  attributes: CanonicalPayload<'purchase_order'>['attributes'];
  supplierId: string;
  lines: PoLineRow[];
}

interface MovementRow {
  tenant_id: string;
  product_id: string;
  type: string;
  quantity: number;
  source: 'qbo';
  source_ref: string;
  occurred_at: string;
}

/** Drain one EntityKind across all pages into canonical payloads + errors. */
async function drainKind(
  adapter: QboSourceAdapter,
  kind: EntityKind,
): Promise<{ items: CanonicalPayload[]; errors: PullResultError[] }> {
  const items: CanonicalPayload[] = [];
  const errors: PullResultError[] = [];
  let cursor: Cursor | null = null;

  for (let page = 0; page < PAGE_CAP; page++) {
    const res: PullResult = await adapter.pull(kind, cursor, `sync:${kind}`);
    items.push(...res.items);
    errors.push(...res.errors);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return { items, errors };
}

/** Batched idempotent upsert. Returns rows newly written (excludes skipped dupes). */
async function upsertBatched(
  admin: SupabaseClient,
  syncRunId: string,
  phase: SyncPhase,
  results: PhaseResult,
  rows: Record<string, unknown>[],
  write: (
    batch: Record<string, unknown>[],
  ) => PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>,
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);
    const { data, error } = await write(batch);
    if (error) throw new Error(`${phase} upsert failed: ${error.message}`);
    written += data?.length ?? 0;
    await writeProgress(admin, syncRunId, phase, results, offset + batch.length, rows.length);
  }
  return written;
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

async function recordFailures(
  admin: SupabaseClient,
  tenantId: string,
  syncRunId: string,
  kind: EntityKind,
  errors: PullResultError[],
): Promise<void> {
  if (errors.length === 0) return;
  await admin.from('sync_failures').insert(
    errors.map((e) => ({
      tenant_id: tenantId,
      sync_run_id: syncRunId,
      entity_type: kind,
      external_ref: e.externalId ?? null,
      payload: null,
      error_code: e.code,
      error_message: e.message,
    })),
  );
}

function flatten(results: PhaseResult): QboSyncCounts {
  const m = results.stock_movement;
  const po = results.purchase_order;
  return {
    catalog: results.product?.written ?? 0,
    suppliers: results.supplier?.written ?? 0,
    ordered: po?.ordered ?? 0,
    inTransit: po?.inTransit ?? 0,
    receipts: m?.receipts ?? 0,
    sales: m?.sales ?? 0,
    errors:
      (results.product?.errors ?? 0) +
      (results.supplier?.errors ?? 0) +
      (m?.errors ?? 0) +
      (po?.errors ?? 0),
    skipped: m?.skipped ?? 0,
  };
}

// ---------- cursor + run lifecycle ----------

async function readResults(admin: SupabaseClient, syncRunId: string): Promise<PhaseResult> {
  const { data } = await admin
    .from('sync_runs')
    .select('cursor')
    .eq('id', syncRunId)
    .single<{ cursor: { results?: PhaseResult } | null }>();
  return data?.cursor?.results ?? {};
}

async function writeProgress(
  admin: SupabaseClient,
  syncRunId: string,
  phase: SyncPhase,
  results: PhaseResult,
  processed: number,
  total: number,
): Promise<void> {
  const counts = flatten(results);
  const cursor: QboSyncCursor = { ...counts, phase, processed, total, results, done: false };
  await admin.from('sync_runs').update({ cursor }).eq('id', syncRunId);
}

async function finalize(
  admin: SupabaseClient,
  syncRunId: string,
  connectionId: string,
  counts: QboSyncCounts,
): Promise<void> {
  const cursor: QboSyncCursor = {
    ...counts,
    phase: 'done',
    processed: 1,
    total: 1,
    results: {},
    done: true,
  };
  await admin
    .from('sync_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      entities_processed: {
        product: counts.catalog,
        supplier: counts.suppliers,
        stock_movement: counts.receipts + counts.sales,
        purchase_order: counts.ordered,
      },
      cursor,
      error_log: [],
    })
    .eq('id', syncRunId);
  await markConnectionSynced(admin, connectionId, new Date().toISOString());
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

export const __test = { flatten, FAILURE_PREVIEW };
