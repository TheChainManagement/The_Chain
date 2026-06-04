/**
 * CSV import commit core (Block 5).
 *
 * The reusable engine the Server Action calls today and a Workflow `"use step"`
 * will wrap in Wave 5.2-durable (durable/resumable for the 50k path) — same
 * functions, one extra orchestration caller, no rewrite.
 *
 * Split of authority:
 *   - Master-data rows (products, suppliers, stock movements) write through the
 *     caller's RLS client, so the tenant + per-kind role gate is enforced at the
 *     data layer (products/suppliers: owner|manager|planner; movements:
 *     owner|manager|warehouse).
 *   - Bookkeeping (sync_runs, sync_failures) and one-time provisioning (the
 *     default "Primary" location) are "system" actions: members are select-only
 *     on those tables, so they write through the service-role admin client with
 *     tenant_id set explicitly to the already-verified tenant.
 *
 * Valid rows always commit; invalid rows land in sync_failures and never block
 * the good ones. Idempotency per kind:
 *   - products  — upsert on (tenant_id, sku).
 *   - suppliers — case-insensitive upsert on (tenant_id, lower(name)) via the
 *     import_suppliers RPC.
 *   - movements — append-only, deduped on a content hash (source_ref) so a
 *     re-uploaded file is skipped, not double-posted.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalPayload, PullResultError } from '@/lib/source-adapter';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { CsvSourceAdapter } from './csv-adapter';
import type { ImportableKind } from './field-specs';
import type { ColumnMapping } from './mapping';

export interface ImportFailure {
  row: number;
  message: string;
}

export interface ImportSummary {
  syncRunId: string;
  imported: number;
  /** Rows already on file (idempotent re-upload) that were intentionally skipped. */
  skipped: number;
  failed: number;
  total: number;
  /** First slice of failures for the UI; full set lands in sync_failures. */
  failures: ImportFailure[];
}

const FAILURE_PREVIEW = 20;

/** Per-kind write outcome, normalized so the orchestrator stays kind-agnostic. */
interface WriteResult {
  ok: boolean;
  /** Fatal error (e.g. RLS rejection) that aborts the whole run. */
  error?: string;
  /** Rows newly written. */
  count: number;
  /** Rows skipped as already-present duplicates (append-only kinds). */
  skipped: number;
  /** Per-row writer failures (unknown SKU, unreadable date) → sync_failures. */
  rowErrors: PullResultError[];
}

export interface RunCsvImportParams {
  tenantClient: SupabaseClient;
  tenantId: string;
  kind: ImportableKind;
  csvText: string;
  mapping: ColumnMapping;
  idempotencyKey: string;
}

export async function runCsvImport(
  params: RunCsvImportParams,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }> {
  const { tenantClient, tenantId, kind, csvText, mapping, idempotencyKey } = params;

  const adapter = new CsvSourceAdapter({ [kind]: { csvText, mapping } });
  const pull = await adapter.pull(kind, null, idempotencyKey);

  const admin = createSupabaseAdmin();
  const connectionId = await ensureCsvConnection(admin, tenantId, adapter.capabilities);

  const { data: runRow, error: runError } = await admin
    .from('sync_runs')
    .insert({
      tenant_id: tenantId,
      connection_id: connectionId,
      workflow_run_id: idempotencyKey,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (runError || !runRow) {
    return { ok: false, error: 'Could not start the import. Please try again.' };
  }
  const syncRunId = runRow.id;

  // Write the valid rows through the RLS client (tenant + per-kind role enforced).
  const write = await writeForKind(kind, tenantClient, admin, tenantId, pull.items);
  if (!write.ok) {
    await finalizeRun(admin, syncRunId, 'failed', 0, kind, [write.error ?? 'write failed']);
    return { ok: false, error: write.error ?? 'Import failed. Please try again.' };
  }

  // Record per-row failures: adapter validation errors + writer-stage errors.
  const allErrors: PullResultError[] = [...pull.errors, ...write.rowErrors];
  if (allErrors.length > 0) {
    await admin.from('sync_failures').insert(
      allErrors.map((e) => ({
        tenant_id: tenantId,
        sync_run_id: syncRunId,
        entity_type: kind,
        external_ref: e.externalId ?? null,
        error_code: e.code,
        error_message: e.message,
      })),
    );
  }

  await finalizeRun(admin, syncRunId, 'completed', write.count, kind, []);

  const failures: ImportFailure[] = allErrors.slice(0, FAILURE_PREVIEW).map((e) => ({
    row: Number(e.externalId) || 0,
    message: e.message,
  }));

  return {
    ok: true,
    summary: {
      syncRunId,
      imported: write.count,
      skipped: write.skipped,
      failed: allErrors.length,
      total: write.count + write.skipped + allErrors.length,
      failures,
    },
  };
}

function writeForKind(
  kind: ImportableKind,
  tenantClient: SupabaseClient,
  admin: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<WriteResult> {
  switch (kind) {
    case 'product':
      return writeProducts(tenantClient, tenantId, items);
    case 'supplier':
      return writeSuppliers(tenantClient, items);
    case 'stock_movement':
      return writeStockMovements(tenantClient, admin, tenantId, items);
  }
}

async function ensureCsvConnection(
  admin: SupabaseClient,
  tenantId: string,
  capabilities: unknown,
): Promise<string> {
  const { data: existing } = await admin
    .from('source_connections')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', 'csv')
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from('source_connections')
    .insert({
      tenant_id: tenantId,
      source: 'csv',
      status: 'active',
      capabilities,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) {
    throw new Error(`Could not create the CSV source connection: ${error?.message ?? 'unknown'}`);
  }
  return created.id;
}

async function writeProducts(
  tenantClient: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<WriteResult> {
  if (items.length === 0) return { ok: true, count: 0, skipped: 0, rowErrors: [] };

  const rows = items.map((item) => {
    const a = item.attributes as {
      sku: string;
      name: string;
      description?: string;
      unitOfMeasure?: string;
      status: 'active' | 'discontinued';
    };
    return {
      tenant_id: tenantId,
      sku: a.sku,
      name: a.name,
      description: a.description ?? null,
      unit_of_measure: a.unitOfMeasure ?? null,
      status: a.status,
      external_ids: { csv: a.sku },
    };
  });

  const { data, error } = await tenantClient
    .from('products')
    .upsert(rows, { onConflict: 'tenant_id,sku' })
    .select('id')
    .returns<{ id: string }[]>();

  if (error) {
    return {
      ok: false,
      error: `Import failed: ${error.message}`,
      count: 0,
      skipped: 0,
      rowErrors: [],
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'You do not have permission to import into this catalog.',
      count: 0,
      skipped: 0,
      rowErrors: [],
    };
  }
  return { ok: true, count: data.length, skipped: 0, rowErrors: [] };
}

async function writeSuppliers(
  tenantClient: SupabaseClient,
  items: CanonicalPayload[],
): Promise<WriteResult> {
  if (items.length === 0) return { ok: true, count: 0, skipped: 0, rowErrors: [] };

  const rows = items.map((item) => {
    const a = item.attributes as {
      name: string;
      defaultLeadTimeDays?: number;
      minOrderValue?: number;
      status: 'active' | 'archived';
    };
    return {
      name: a.name,
      default_lead_time_days: a.defaultLeadTimeDays ?? null,
      min_order_value: a.minOrderValue ?? null,
      status: a.status,
    };
  });

  // Case-insensitive idempotent upsert lives in SQL (ON CONFLICT can't name the
  // lower(name) expression index from supabase-js). RLS inside the SECURITY
  // INVOKER function enforces the owner|manager|planner gate.
  const { data, error } = await tenantClient.rpc('import_suppliers', { p_rows: rows });

  if (error) {
    return {
      ok: false,
      error: mapSupplierWriteError(error.message),
      count: 0,
      skipped: 0,
      rowErrors: [],
    };
  }
  const count = typeof data === 'number' ? data : items.length;
  return { ok: true, count, skipped: 0, rowErrors: [] };
}

async function writeStockMovements(
  tenantClient: SupabaseClient,
  admin: SupabaseClient,
  tenantId: string,
  items: CanonicalPayload[],
): Promise<WriteResult> {
  if (items.length === 0) return { ok: true, count: 0, skipped: 0, rowErrors: [] };

  // Resolve SKU → product_id; an unknown SKU is a per-row failure, not fatal.
  const skus = [
    ...new Set(items.map((i) => (i.attributes as { productExternalId: string }).productExternalId)),
  ];
  const { data: prods, error: prodErr } = await tenantClient
    .from('products')
    .select('id, sku')
    .in('sku', skus)
    .returns<{ id: string; sku: string }[]>();

  if (prodErr) {
    return {
      ok: false,
      error: `Import failed: ${prodErr.message}`,
      count: 0,
      skipped: 0,
      rowErrors: [],
    };
  }
  const skuToId = new Map((prods ?? []).map((p) => [p.sku, p.id]));

  const rowErrors: PullResultError[] = [];
  const rows: StockMovementRow[] = [];

  for (const item of items) {
    const a = item.attributes as {
      productExternalId: string;
      type: string;
      quantity: number;
      occurredAt: string;
    };
    const productId = skuToId.get(a.productExternalId);
    if (!productId) {
      rowErrors.push({
        externalId: a.productExternalId,
        code: 'unknown_sku',
        message: `No SKU "${a.productExternalId}" in your catalog. Import that product first.`,
      });
      continue;
    }
    const occurred = new Date(a.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      rowErrors.push({
        externalId: a.productExternalId,
        code: 'invalid_date',
        message: `Movement for "${a.productExternalId}" has an unreadable date "${a.occurredAt}".`,
      });
      continue;
    }
    const occurredIso = occurred.toISOString();
    rows.push({
      tenant_id: tenantId,
      product_id: productId,
      type: a.type,
      quantity: a.quantity,
      source: 'csv',
      // Content hash: re-uploading the same file collides here → skipped, not duped.
      source_ref: movementSourceRef(a.productExternalId, a.type, a.quantity, occurredIso),
      occurred_at: occurredIso,
    });
  }

  if (rows.length === 0) {
    return { ok: true, count: 0, skipped: 0, rowErrors };
  }

  // A location is required; greenfield tenants have none, so provision a single
  // "Primary" one (system action via admin — the warehouse role can write
  // movements but not locations).
  const locationId = await ensurePrimaryLocation(admin, tenantId);
  const located = rows.map((r) => ({ ...r, location_id: locationId }));

  const { data, error } = await tenantClient
    .from('stock_movements')
    .upsert(located, {
      onConflict: 'tenant_id,source,source_ref,occurred_at',
      ignoreDuplicates: true,
    })
    .select('id')
    .returns<{ id: string }[]>();

  if (error) {
    // RLS rejection (wrong role) lands here as a policy-violation error; with
    // ignoreDuplicates an all-duplicate re-upload is NOT an error (empty data),
    // so we trust the error object rather than an empty result.
    return {
      ok: false,
      error: mapMovementWriteError(error.message),
      count: 0,
      skipped: 0,
      rowErrors,
    };
  }
  const inserted = data?.length ?? 0;
  return { ok: true, count: inserted, skipped: rows.length - inserted, rowErrors };
}

interface StockMovementRow {
  tenant_id: string;
  product_id: string;
  type: string;
  quantity: number;
  source: 'csv';
  source_ref: string;
  occurred_at: string;
}

function movementSourceRef(
  sku: string,
  type: string,
  quantity: number,
  occurredIso: string,
): string {
  return createHash('sha1')
    .update([sku, type, String(quantity), occurredIso].join(' '))
    .digest('hex');
}

async function ensurePrimaryLocation(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data: existing } = await admin
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from('locations')
    .insert({ tenant_id: tenantId, name: 'Primary', type: 'warehouse' })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) {
    throw new Error(`Could not provision a default location: ${error?.message ?? 'unknown'}`);
  }
  return created.id;
}

function mapSupplierWriteError(message: string): string {
  if (/row-level security|permission|policy/i.test(message)) {
    return 'You do not have permission to import suppliers.';
  }
  return `Import failed: ${message}`;
}

function mapMovementWriteError(message: string): string {
  if (/row-level security|permission|policy/i.test(message)) {
    return 'You do not have permission to import sales and movements.';
  }
  return `Import failed: ${message}`;
}

async function finalizeRun(
  admin: SupabaseClient,
  syncRunId: string,
  status: 'completed' | 'failed',
  imported: number,
  kind: ImportableKind,
  errorLog: string[],
): Promise<void> {
  await admin
    .from('sync_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      entities_processed: { [kind]: imported },
      error_log: errorLog,
    })
    .eq('id', syncRunId);
}
